import http from "node:http";
import { Command } from "commander";

// ---------------------------------------------------------------------------
// Request transformation: Anthropic Messages API → OpenAI Chat Completions
// ---------------------------------------------------------------------------

export function sanitizeToolId(id: string): string {
  // Bedrock expects tool IDs to match ^[a-zA-Z0-9_-]+$
  // Replace invalid chars with underscore and ensure starts with letter
  let sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = "tc_" + sanitized;
  }
  return sanitized;
}

export function transformAnthropicToOpenAI(body: Record<string, any>): Record<string, any> {
  const messages: any[] = [];

  // System prompt
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
      // tool_result blocks → individual tool messages
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

      // Text and image blocks → user message
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
        // If only text parts, simplify to string
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

// ---------------------------------------------------------------------------
// Response transformation: OpenAI → Anthropic (non-streaming)
// ---------------------------------------------------------------------------

export function transformOpenAIResponseToAnthropic(
  openaiResponse: any,
  originalModel: string,
): any {
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

// ---------------------------------------------------------------------------
// Stream synthesis: Anthropic response object → Anthropic SSE
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Embedded proxy server
// ---------------------------------------------------------------------------

export async function startOpenAIProxy(
  targetUrl: string,
  apiKey: string,
  model: string,
  models: string[] = [],
): Promise<{ baseUrl: string; stop: () => void }> {
  const base = targetUrl.replace(/\/+$/, "");

  const server = http.createServer(async (req, res) => {
    try {
      // Models endpoint — return all available models
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        const modelList = models.length > 0 ? models : [model];
        const response = {
          object: "list",
          data: modelList.map((m) => ({ id: m, object: "model" })),
        };
        res.end(JSON.stringify(response));
        return;
      }

      // Messages endpoint
      if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
        const body = await readBody(req);
        let parsed: Record<string, any>;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "invalid JSON" } }));
          return;
        }

        const isStream = !!parsed.stream;
        // Always request non-streaming from OpenAI so that token counts are
        // available upfront and can be placed in message_start, which is what
        // Claude Code uses to populate the context bar.
        const openaiBody = transformAnthropicToOpenAI({ ...parsed, stream: false });

        if (isStream) {
          // Send headers immediately so Claude Code's connection doesn't time
          // out while we wait for a slow OpenAI response (e.g. /compact).
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          });
          // SSE keepalive comments prevent the connection from being closed
          // before the (potentially large) OpenAI response arrives.
          const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
          try {
            const upstream = await fetch(`${base}/v1/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
              },
              body: JSON.stringify(openaiBody),
            });
            if (!upstream.ok) {
              const errText = await upstream.text();
              res.write(`event: error\ndata: ${errText}\n\n`);
              res.end();
              return;
            }
            const data = await upstream.json();
            const anthropicResponse = transformOpenAIResponseToAnthropic(data, parsed.model ?? model);
            for (const chunk of synthesizeAnthropicSSE(anthropicResponse)) {
              res.write(chunk);
            }
            res.end();
          } finally {
            clearInterval(keepalive);
          }
          return;
        }

        const upstream = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(openaiBody),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          res.writeHead(upstream.status, { "Content-Type": "application/json" });
          res.end(errText);
          return;
        }

        const data = await upstream.json();
        const anthropicResponse = transformOpenAIResponseToAnthropic(data, parsed.model ?? model);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(anthropicResponse));

        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "not_found", message: "endpoint not found" } }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { type: "internal_error", message: String(err) } }));
      }
    }
  });

  // Let OS pick a free port and wait for it to be ready
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        stop: () => server.close(),
      });
    });
    server.on("error", reject);
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// provider list command
// ---------------------------------------------------------------------------

const PROVIDERS = [
  {
    name: "anthropic",
    description: "Default — sends Anthropic-format requests directly to the configured URL",
  },
  {
    name: "openai",
    description:
      "Embedded proxy — translates Anthropic requests to OpenAI Chat Completions format",
  },
];

export function providerCommand(): Command {
  const cmd = new Command("provider").description("Manage provider types");

  cmd
    .command("list")
    .description("List available provider types")
    .action(() => {
      const fmt = (name: string, desc: string) =>
        `${name.padEnd(12)}  ${desc}`;
      console.log(fmt("NAME", "DESCRIPTION"));
      console.log(fmt("----", "-----------"));
      for (const p of PROVIDERS) {
        console.log(fmt(p.name, p.description));
      }
    });

  return cmd;
}
