import { describe, it, expect } from "vitest";
import {
  sanitizeToolId,
  transformAnthropicToOpenAI,
  transformOpenAIResponseToAnthropic,
  synthesizeAnthropicSSE,
} from "../../src/provider/transform.js";

// ---------------------------------------------------------------------------
// sanitizeToolId
// ---------------------------------------------------------------------------

describe("sanitizeToolId", () => {
  it("leaves alphanumeric+dash+underscore IDs unchanged", () => {
    expect(sanitizeToolId("toolu_abc123")).toBe("toolu_abc123");
    expect(sanitizeToolId("tool-call_1")).toBe("tool-call_1");
  });

  it("replaces invalid characters with underscore", () => {
    expect(sanitizeToolId("tool:call.id")).toBe("tool_call_id");
  });

  it("prepends tc_ when ID starts with a non-letter", () => {
    expect(sanitizeToolId("123abc")).toBe("tc_123abc");
    expect(sanitizeToolId("_start")).toBe("tc__start");
  });
});

// ---------------------------------------------------------------------------
// transformAnthropicToOpenAI
// ---------------------------------------------------------------------------

describe("transformAnthropicToOpenAI — basic structure", () => {
  it("converts a simple text message", () => {
    const result = transformAnthropicToOpenAI({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    });
    expect(result.model).toBe("claude-opus-4-7");
    expect(result.max_tokens).toBe(1024);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("sets stream to false by default", () => {
    const result = transformAnthropicToOpenAI({ model: "m", messages: [] });
    expect(result.stream).toBe(false);
  });

  it("respects explicit stream flag", () => {
    const result = transformAnthropicToOpenAI({ model: "m", messages: [], stream: true });
    expect(result.stream).toBe(true);
  });

  it("prepends a system message when body.system is a string", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      system: "You are helpful.",
      messages: [],
    });
    expect(result.messages[0]).toEqual({ role: "system", content: "You are helpful." });
  });

  it("concatenates system array blocks into one system message", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      system: [
        { type: "text", text: "Part 1." },
        { type: "text", text: "Part 2." },
      ],
      messages: [],
    });
    expect(result.messages[0]).toEqual({ role: "system", content: "Part 1.\nPart 2." });
  });

  it("ignores non-text blocks in system array", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      system: [{ type: "tool_result", text: "skip" }],
      messages: [],
    });
    expect(result.messages).toHaveLength(0);
  });
});

describe("transformAnthropicToOpenAI — user message content blocks", () => {
  it("converts text blocks in user message", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    expect(result.messages[0]).toEqual({ role: "user", content: "Hi" });
  });

  it("converts base64 image blocks to data URI", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
          ],
        },
      ],
    });
    const msg = result.messages[0];
    expect(msg.content[0].type).toBe("image_url");
    expect(msg.content[0].image_url.url).toBe("data:image/png;base64,abc123");
  });

  it("converts tool_result blocks into tool-role messages", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_01", content: "42" },
          ],
        },
      ],
    });
    expect(result.messages[0]).toEqual({
      role: "tool",
      tool_call_id: "toolu_01",
      content: "42",
    });
  });

  it("concatenates array content in tool_result", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tid",
              content: [
                { type: "text", text: "part1" },
                { type: "text", text: "part2" },
              ],
            },
          ],
        },
      ],
    });
    expect(result.messages[0].content).toBe("part1part2");
  });
});

describe("transformAnthropicToOpenAI — assistant messages", () => {
  it("converts assistant text content", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [{ role: "assistant", content: [{ type: "text", text: "I will help." }] }],
    });
    expect(result.messages[0]).toMatchObject({ role: "assistant", content: "I will help." });
  });

  it("converts tool_use blocks to tool_calls", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_02", name: "bash", input: { command: "ls" } },
          ],
        },
      ],
    });
    const msg = result.messages[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0]).toMatchObject({
      id: "toolu_02",
      type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command: "ls" }) },
    });
  });
});

describe("transformAnthropicToOpenAI — tools", () => {
  it("converts tool definitions to OpenAI function format", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [],
      tools: [
        {
          name: "bash",
          description: "Run shell commands",
          input_schema: { type: "object", properties: { command: { type: "string" } } },
        },
      ],
    });
    expect(result.tools[0]).toEqual({
      type: "function",
      function: {
        name: "bash",
        description: "Run shell commands",
        parameters: { type: "object", properties: { command: { type: "string" } } },
      },
    });
  });

  it("maps tool_choice type=auto correctly", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [],
      tools: [{ name: "t", description: "", input_schema: {} }],
      tool_choice: { type: "auto" },
    });
    expect(result.tool_choice).toBe("auto");
  });

  it("maps tool_choice type=tool to function format", () => {
    const result = transformAnthropicToOpenAI({
      model: "m",
      messages: [],
      tools: [{ name: "bash", description: "", input_schema: {} }],
      tool_choice: { type: "tool", name: "bash" },
    });
    expect(result.tool_choice).toEqual({ type: "function", function: { name: "bash" } });
  });
});

// ---------------------------------------------------------------------------
// transformOpenAIResponseToAnthropic
// ---------------------------------------------------------------------------

describe("transformOpenAIResponseToAnthropic", () => {
  const baseOpenAIResponse = {
    id: "chatcmpl-abc",
    model: "gpt-4o",
    choices: [
      {
        message: { role: "assistant", content: "Hello!" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };

  it("converts a simple text response", () => {
    const result = transformOpenAIResponseToAnthropic(baseOpenAIResponse, "gpt-4o");
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toEqual([{ type: "text", text: "Hello!" }]);
    expect(result.stop_reason).toBe("end_turn");
  });

  it("maps finish_reason=length to max_tokens", () => {
    const resp = { ...baseOpenAIResponse, choices: [{ ...baseOpenAIResponse.choices[0], finish_reason: "length" }] };
    const result = transformOpenAIResponseToAnthropic(resp, "m");
    expect(result.stop_reason).toBe("max_tokens");
  });

  it("maps finish_reason=tool_calls to tool_use", () => {
    const resp = {
      id: "c",
      model: "m",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "tc1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    };
    const result = transformOpenAIResponseToAnthropic(resp, "m");
    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "tc1", name: "bash", input: { command: "ls" } },
    ]);
  });

  it("handles malformed tool_calls arguments gracefully", () => {
    const resp = {
      id: "c",
      model: "m",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "tc1", type: "function", function: { name: "f", arguments: "NOT JSON" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const result = transformOpenAIResponseToAnthropic(resp, "m");
    expect(result.content[0].input).toEqual({ text: "NOT JSON" });
  });

  it("computes correct token usage including cache_read_input_tokens", () => {
    const resp = {
      id: "c",
      model: "m",
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    };
    const result = transformOpenAIResponseToAnthropic(resp, "m");
    expect(result.usage.input_tokens).toBe(60); // 100 - 40
    expect(result.usage.output_tokens).toBe(20);
    expect(result.usage.cache_read_input_tokens).toBe(40);
  });

  it("throws when choices array is empty", () => {
    expect(() =>
      transformOpenAIResponseToAnthropic({ choices: [] }, "m"),
    ).toThrow("No choices in OpenAI response");
  });
});

// ---------------------------------------------------------------------------
// synthesizeAnthropicSSE
// ---------------------------------------------------------------------------

describe("synthesizeAnthropicSSE", () => {
  function collectSSE(resp: any): string[] {
    return [...synthesizeAnthropicSSE(resp)];
  }

  function parseEvents(chunks: string[]): Array<{ event: string; data: any }> {
    return chunks.map((c) => {
      const lines = c.trim().split("\n");
      const event = lines[0].replace("event: ", "");
      const data = JSON.parse(lines[1].replace("data: ", ""));
      return { event, data };
    });
  }

  it("produces message_start as first event", () => {
    const resp = { id: "msg1", model: "m", content: [], stop_reason: "end_turn", usage: {} };
    const events = parseEvents(collectSSE(resp));
    expect(events[0].event).toBe("message_start");
    expect(events[0].data.message.id).toBe("msg1");
  });

  it("produces message_stop as last event", () => {
    const resp = { id: "msg1", model: "m", content: [], stop_reason: "end_turn", usage: {} };
    const events = parseEvents(collectSSE(resp));
    expect(events[events.length - 1].event).toBe("message_stop");
  });

  it("yields content_block_start, delta, stop for a text block", () => {
    const resp = {
      id: "m",
      model: "m",
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: {},
    };
    const events = parseEvents(collectSSE(resp));
    const blockEvents = events.filter((e) =>
      ["content_block_start", "content_block_delta", "content_block_stop"].includes(e.event),
    );
    expect(blockEvents[0].event).toBe("content_block_start");
    expect(blockEvents[0].data.content_block.type).toBe("text");
    expect(blockEvents[1].event).toBe("content_block_delta");
    expect(blockEvents[1].data.delta.text).toBe("hello");
    expect(blockEvents[2].event).toBe("content_block_stop");
  });

  it("yields correct events for a tool_use block", () => {
    const resp = {
      id: "m",
      model: "m",
      content: [{ type: "tool_use", id: "tid", name: "bash", input: { cmd: "ls" } }],
      stop_reason: "tool_use",
      usage: {},
    };
    const events = parseEvents(collectSSE(resp));
    const start = events.find((e) => e.event === "content_block_start");
    expect(start!.data.content_block.type).toBe("tool_use");
    const delta = events.find((e) => e.event === "content_block_delta");
    expect(delta!.data.delta.type).toBe("input_json_delta");
    expect(JSON.parse(delta!.data.delta.partial_json)).toEqual({ cmd: "ls" });
  });

  it("includes output_tokens in message_delta", () => {
    const resp = {
      id: "m",
      model: "m",
      content: [],
      stop_reason: "end_turn",
      usage: { output_tokens: 42 },
    };
    const events = parseEvents(collectSSE(resp));
    const delta = events.find((e) => e.event === "message_delta");
    expect(delta!.data.usage.output_tokens).toBe(42);
  });
});
