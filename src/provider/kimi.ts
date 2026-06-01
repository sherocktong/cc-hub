import * as logger from "../logger.js";
import { sanitizeToolId, buildSystemMessage, convertAnthropicContentPart } from "./transform.js";

/**
 * Kimi-specific transformer for Anthropic ↔ OpenAI format conversion.
 *
 * Kimi API compatibility issues:
 * 1. When `thinking` is enabled but assistant messages contain `tool_use` blocks,
 *    Kimi expects either NO `reasoning_content` field, or the field to be present
 *    with valid content. Claude Code sends assistant tool call messages that may
 *    have been synthesized with empty/missing reasoning_content, causing:
 *    "400 thinking is enabled but reasoning_content is missing in assistant tool call message"
 *
 * 2. Kimi uses `reasoning_content` instead of Anthropic's `thinking` block format.
 *
 * This transformer strips `reasoning_content` from assistant messages that also
 * contain `tool_calls`, since Kimi cannot handle the combination.
 */

export function transformAnthropicToKimi(body: Record<string, any>): Record<string, any> {
  logger.debug(`transform: anthropic -> kimi model=${body.model} messages=${(body.messages ?? []).length}`);
  const messages: any[] = [];

  logger.debug(`transform: anthropic -> kimi messageCount=${(body.messages ?? []).length}`);

  if (body.system) {
    const systemMsg = buildSystemMessage(body.system);
    if (systemMsg) messages.push(systemMsg);
  }

  for (const msg of body.messages ?? []) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (!Array.isArray(msg.content)) {
      messages.push({ role: msg.role, content: JSON.stringify(msg.content) });
      continue;
    }

    if (msg.role === "user") {
      const toolResults = msg.content.filter(
        (b: any) => b.type === "tool_result" && b.tool_use_id,
      );
      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: sanitizeToolId(tr.tool_use_id),
          content:
            typeof tr.content === "string"
              ? tr.content
              : Array.isArray(tr.content)
                ? tr.content
                    .filter((b: any) => b.type === "text")
                    .map((b: any) => b.text)
                    .join("")
                : JSON.stringify(tr.content),
        });
      }

      const contentParts = msg.content.filter(
        (b: any) =>
          (b.type === "text" && b.text) ||
          (b.type === "image" &&
            ((b.source?.type === "base64" && b.source.media_type && b.source.data) ||
              (b.source?.type === "url" && b.source.url))),
      );
      if (contentParts.length > 0) {
        const converted = contentParts.map(convertAnthropicContentPart).filter(Boolean);
        if (converted.length === 0) {
          // All content parts were invalid — nothing to add for this message
        } else if (
          converted.every((p: any) => p.type === "text") &&
          !converted.some((p: any) => p.cache_control)
        ) {
          messages.push({
            role: "user",
            content: converted.map((p: any) => p.text).join(""),
          });
        } else {
          messages.push({ role: "user", content: converted });
        }
      }
    } else if (msg.role === "assistant") {
      const assistantMsg: any = { role: "assistant", content: null };

      const textParts = msg.content.filter(
        (b: any) => b.type === "text" && b.text,
      );
      if (textParts.length > 0) {
        assistantMsg.content = textParts.map((b: any) => b.text).join("\n");
      }

      const thinkingParts = msg.content.filter(
        (b: any) => b.type === "thinking" && b.thinking,
      );
      const toolUseParts = msg.content.filter(
        (b: any) => b.type === "tool_use" && b.id,
      );

      if (toolUseParts.length > 0) {
        assistantMsg.tool_calls = toolUseParts.map((b: any) => ({
          id: sanitizeToolId(b.id),
          type: "function",
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input ?? {}),
          },
        }));

        if (thinkingParts.length > 0) {
          assistantMsg.reasoning_content = thinkingParts.map((b: any) => b.thinking).join("\n");
        } else {
          assistantMsg.reasoning_content = " ";
        }
      } else if (thinkingParts.length > 0) {
        assistantMsg.reasoning_content = thinkingParts.map((b: any) => b.thinking).join("\n");
      }

      messages.push(assistantMsg);
    }
  }

  const result: Record<string, any> = {
    model: body.model,
    messages,
    stream: body.stream ?? false,
  };

  if (body.max_tokens != null) result.max_tokens = body.max_tokens;
  if (body.temperature != null) result.temperature = body.temperature;

  if (body.tools?.length) {
    logger.debug(`transform: mapping ${body.tools.length} tool(s)`);
    result.tools = body.tools.map((t: any) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.input_schema,
      },
    }));

    if (body.tool_choice) {
      const tc = body.tool_choice;
      if (tc.type === "auto" || tc.type === "none" || tc.type === "required") {
        result.tool_choice = tc.type;
      } else if (tc.type === "tool") {
        result.tool_choice = {
          type: "function",
          function: { name: tc.name },
        };
      }
    }
  }

  return result;
}

export function transformKimiResponseToAnthropic(
  kimiResponse: any,
  originalModel: string,
): any {
  logger.debug(`transform: kimi -> anthropic model=${kimiResponse.model ?? originalModel} choices=${kimiResponse.choices?.length ?? 0}`);
  const choice = kimiResponse.choices?.[0];
  if (!choice) throw new Error("No choices in Kimi response");

  const content: any[] = [];

  if (choice.message?.reasoning_content) {
    content.push({
      type: "thinking",
      thinking: choice.message.reasoning_content,
      signature: "",
    });
  }

  if (choice.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (choice.message?.tool_calls?.length) {
    for (const tc of choice.message.tool_calls) {
      let input: any = {};
      try {
        input =
          typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
      } catch {
        input = { text: tc.function.arguments ?? "" };
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  const finishMap: Record<string, string> = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    content_filter: "stop_sequence",
  };

  return {
    id: kimiResponse.id ?? `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: originalModel,
    content,
    stop_reason: finishMap[choice.finish_reason] ?? "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens:
        (kimiResponse.usage?.prompt_tokens ?? 0) -
        (kimiResponse.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      output_tokens: kimiResponse.usage?.completion_tokens ?? 0,
      cache_read_input_tokens:
        kimiResponse.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cache_creation_input_tokens:
        kimiResponse.usage?.prompt_tokens_details?.cache_creation_tokens ?? 0,
    },
  };
}
