import http from "node:http";
import {
  transformAnthropicToOpenAI,
  transformOpenAIResponseToAnthropic,
  synthesizeAnthropicSSE,
} from "./transform.js";
import * as logger from "../logger.js";

export async function startOpenAIProxy(
  targetUrl: string,
  apiKey: string,
  model: string,
  models: string[] = [],
  modelMappings: Record<string, string> = {},
): Promise<{ baseUrl: string; stop: () => void }> {
  const base = targetUrl.replace(/\/+$/, "");

  const server = http.createServer(async (req, res) => {
    logger.debug(`Proxy request: ${req.method} ${req.url}`);
    try {
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
        const requestModel = parsed.model ?? model;
        const actualModel = modelMappings[requestModel] || requestModel;
        const openaiBody = transformAnthropicToOpenAI({ ...parsed, model: actualModel, stream: false });

        if (isStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          });
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
              logger.error(`Upstream streaming error: ${upstream.status} ${errText}`);
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
          logger.error(`Upstream error: ${upstream.status} ${errText}`);
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
      logger.error("Proxy request handler error", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { type: "internal_error", message: String(err) } }));
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      logger.debug(`OpenAI proxy listening on ${baseUrl}`);
      resolve({
        baseUrl,
        stop: () => {
          logger.debug("OpenAI proxy stopped");
          server.close();
        },
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
