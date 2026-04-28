export function sanitizeToolId(id: string): string {
  let sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = "tc_" + sanitized;
  }
  return sanitized;
}

import * as logger from "../logger.js";

export function transformAnthropicToOpenAI(body: Record<string, any>): Record<string, any> {
  logger.debug(`transform: anthropic -> openai model=${body.model} messages=${(body.messages ?? []).length}`);
  const messages: any[] = [];

  if (body.system) {
    if (typeof body.system === "string") {
      messages.push({ role: "system", content: body.system });
    } else if (Array.isArray(body.system)) {
      const text = body.system
        .filter((b: any) => b.type === "text" && b.text)
        .map((b: any) => b.text)
        .join("\n");
      if (text) messages.push({ role: "system", content: text });
    }
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
          (b.type === "image" && b.source),
      );
      if (contentParts.length > 0) {
        const converted = contentParts.map((part: any) => {
          if (part.type === "image") {
            const url =
              part.source?.type === "base64"
                ? `data:${part.source.media_type};base64,${part.source.data}`
                : part.source?.url ?? "";
            return { type: "image_url", image_url: { url } };
          }
          return { type: "text", text: part.text };
        });
        if (converted.every((p: any) => p.type === "text")) {
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

export function transformOpenAIResponseToAnthropic(
  openaiResponse: any,
  originalModel: string,
): any {
  logger.debug(`transform: openai -> anthropic model=${openaiResponse.model ?? originalModel} choices=${openaiResponse.choices?.length ?? 0}`);
  const choice = openaiResponse.choices?.[0];
  if (!choice) throw new Error("No choices in OpenAI response");

  const content: any[] = [];

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
    id: openaiResponse.id ?? `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: openaiResponse.model ?? originalModel,
    content,
    stop_reason: finishMap[choice.finish_reason] ?? "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens:
        (openaiResponse.usage?.prompt_tokens ?? 0) -
        (openaiResponse.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      output_tokens: openaiResponse.usage?.completion_tokens ?? 0,
      cache_read_input_tokens:
        openaiResponse.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

export function* synthesizeAnthropicSSE(
  anthropicResponse: any,
): Generator<string> {
  const sse = (event: string, data: any) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  const usage = anthropicResponse.usage ?? {};
  yield sse("message_start", {
    type: "message_start",
    message: {
      id: anthropicResponse.id,
      type: "message",
      role: "assistant",
      content: [],
      model: anthropicResponse.model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      },
    },
  });

  for (let i = 0; i < (anthropicResponse.content ?? []).length; i++) {
    const block = anthropicResponse.content[i];
    yield sse("content_block_start", {
      type: "content_block_start",
      index: i,
      content_block:
        block.type === "tool_use"
          ? { type: "tool_use", id: block.id, name: block.name, input: {} }
          : { type: "text", text: "" },
    });

    if (block.type === "text" && block.text) {
      yield sse("content_block_delta", {
        type: "content_block_delta",
        index: i,
        delta: { type: "text_delta", text: block.text },
      });
    } else if (block.type === "tool_use" && block.input) {
      yield sse("content_block_delta", {
        type: "content_block_delta",
        index: i,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    }

    yield sse("content_block_stop", { type: "content_block_stop", index: i });
  }

  yield sse("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: anthropicResponse.stop_reason ?? "end_turn",
      stop_sequence: anthropicResponse.stop_sequence ?? null,
    },
    usage: { output_tokens: usage.output_tokens ?? 0 },
  });

  yield sse("message_stop", { type: "message_stop" });
}
