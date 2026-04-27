import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { startOpenAIProxy } from "../../src/provider/server.js";

const FAKE_MODEL = "gpt-4o";
const FAKE_KEY = "sk-test";
const FAKE_BASE = "https://api.openai.com";

function openAIResponse(content: string, finish = "stop", id = "cmpl-1") {
  return {
    id,
    model: FAKE_MODEL,
    choices: [{ message: { role: "assistant", content }, finish_reason: finish }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

async function startProxy(models: string[] = [FAKE_MODEL]) {
  return startOpenAIProxy(FAKE_BASE, FAKE_KEY, FAKE_MODEL, models);
}

// Build a smart fetch mock that:
//  - passes real HTTP requests to 127.0.0.1 (the proxy itself)
//  - intercepts "upstream" OpenAI calls and returns a preset response
function mockUpstreamFetch(upstreamResponse: () => Promise<Partial<Response>>) {
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.includes("127.0.0.1")) {
      return realFetch(input, init);
    }
    return upstreamResponse() as Promise<Response>;
  });
}

// ---------------------------------------------------------------------------
// Models endpoint
// ---------------------------------------------------------------------------

describe("GET /v1/models", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the model list as OpenAI format", async () => {
    const { baseUrl, stop } = await startProxy(["gpt-4o", "gpt-3.5-turbo"]);
    try {
      const res = await fetch(`${baseUrl}/v1/models`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.object).toBe("list");
      expect(json.data.map((d: any) => d.id)).toEqual(["gpt-4o", "gpt-3.5-turbo"]);
    } finally {
      stop();
    }
  });

  it("falls back to single default model when list is empty", async () => {
    const { baseUrl, stop } = await startOpenAIProxy(FAKE_BASE, FAKE_KEY, "gpt-4o", []);
    try {
      const res = await fetch(`${baseUrl}/v1/models`);
      const json = await res.json() as any;
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe("gpt-4o");
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Unknown endpoint
// ---------------------------------------------------------------------------

describe("unknown endpoint", () => {
  it("returns 404 for unknown routes", async () => {
    const { baseUrl, stop } = await startProxy();
    try {
      const res = await fetch(`${baseUrl}/v1/unknown`);
      expect(res.status).toBe(404);
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /v1/messages — invalid JSON body
// ---------------------------------------------------------------------------

describe("POST /v1/messages — invalid body", () => {
  it("returns 400 for malformed JSON", async () => {
    const { baseUrl, stop } = await startProxy();
    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "NOT JSON",
      });
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error.type).toBe("invalid_request_error");
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /v1/messages — non-streaming
// ---------------------------------------------------------------------------

describe("POST /v1/messages — non-streaming", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("proxies a simple message and returns Anthropic-format response", async () => {
    mockUpstreamFetch(async () => ({
      ok: true,
      json: async () => openAIResponse("Hello from AI"),
    }));

    const { baseUrl, stop } = await startProxy();
    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: FAKE_MODEL,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 100,
          stream: false,
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.type).toBe("message");
      expect(json.role).toBe("assistant");
      expect(json.content[0].text).toBe("Hello from AI");
      expect(json.stop_reason).toBe("end_turn");
    } finally {
      stop();
    }
  });

  it("forwards upstream error status and body when OpenAI returns non-ok", async () => {
    mockUpstreamFetch(async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: "rate limit" }),
    }));

    const { baseUrl, stop } = await startProxy();
    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: FAKE_MODEL, messages: [], stream: false }),
      });
      expect(res.status).toBe(429);
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /v1/messages — streaming
// ---------------------------------------------------------------------------

describe("POST /v1/messages — streaming", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns SSE response with correct event sequence", async () => {
    mockUpstreamFetch(async () => ({
      ok: true,
      json: async () => openAIResponse("Streamed response"),
    }));

    const { baseUrl, stop } = await startProxy();
    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: FAKE_MODEL,
          messages: [{ role: "user", content: "Say something" }],
          stream: true,
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain("event: message_start");
      expect(text).toContain("event: content_block_start");
      expect(text).toContain("Streamed response");
      expect(text).toContain("event: message_stop");
    } finally {
      stop();
    }
  });

  it("sends SSE error event when upstream fails during streaming", async () => {
    mockUpstreamFetch(async () => ({
      ok: false,
      text: async () => "upstream error",
    }));

    const { baseUrl, stop } = await startProxy();
    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: FAKE_MODEL, messages: [], stream: true }),
      });
      const text = await res.text();
      // The proxy writes `event: error\ndata: ...\n\n` on upstream failure
      expect(text).toMatch(/event: error/);
    } finally {
      stop();
    }
  });

  it("always requests non-streaming from upstream regardless of client stream flag", async () => {
    let capturedBody: any;
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("127.0.0.1")) return realFetch(input, init);
      capturedBody = JSON.parse((init as any).body);
      return { ok: true, json: async () => openAIResponse("ok") } as Response;
    });

    const { baseUrl, stop } = await startProxy();
    try {
      await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: FAKE_MODEL, messages: [], stream: true }),
      });
      expect(capturedBody.stream).toBe(false);
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Proxy: tool use round-trip
// ---------------------------------------------------------------------------

describe("POST /v1/messages — tool use", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("converts tool calls in upstream response to Anthropic tool_use blocks", async () => {
    mockUpstreamFetch(async () => ({
      ok: true,
      json: async () => ({
        id: "cmpl-tc",
        model: FAKE_MODEL,
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
      }),
    }));

    const { baseUrl, stop } = await startProxy();
    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: FAKE_MODEL,
          messages: [{ role: "user", content: "run ls" }],
          tools: [{ name: "bash", description: "run shell", input_schema: { type: "object" } }],
          stream: false,
        }),
      });
      const json = await res.json() as any;
      expect(json.stop_reason).toBe("tool_use");
      expect(json.content[0]).toMatchObject({
        type: "tool_use",
        name: "bash",
        input: { command: "ls" },
      });
    } finally {
      stop();
    }
  });

  it("forwards tool definitions in OpenAI function format to upstream", async () => {
    let capturedBody: any;
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("127.0.0.1")) return realFetch(input, init);
      capturedBody = JSON.parse((init as any).body);
      return { ok: true, json: async () => openAIResponse("ok") } as Response;
    });

    const { baseUrl, stop } = await startProxy();
    try {
      await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: FAKE_MODEL,
          messages: [],
          tools: [{ name: "read_file", description: "reads a file", input_schema: { type: "object" } }],
          stream: false,
        }),
      });
      expect(capturedBody.tools[0].type).toBe("function");
      expect(capturedBody.tools[0].function.name).toBe("read_file");
    } finally {
      stop();
    }
  });
});
