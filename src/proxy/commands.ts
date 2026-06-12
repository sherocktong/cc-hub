import { Command } from "commander";
import { startOpenAIProxy } from "../provider/server.js";
import { isAnthropicModel, ANTHROPIC_ALIASES } from "../provider/index.js";
import { safeAction } from "../logger.js";
import { ensureProfilesFile, readJson, PROFILES_FILE } from "../config.js";
import { getClaudeVersion } from "../platform/index.js";
import type { ProfilesData } from "../types.js";

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function proxyCommand(): Command {
  return new Command("proxy")
    .description("Start a standalone OpenAI proxy for the desktop app")
    .option("--profile <name>", "Use configuration from a saved profile")
    .option("-u, --url <url>", "Upstream base URL (e.g., https://api.openai.com)")
    .option("-k, --api-key <key>", "Upstream API key")
    .option("-m, --model <model>", "Default model", "gpt-4o")
    .option("--mapping <mapping>", "Model alias mapping (format: alias:actual, can be used multiple times)", collect, [])
    .action(safeAction(async (opts: { profile?: string; url?: string; apiKey?: string; model?: string; mapping: string[] }) => {
      let targetUrl = opts.url || "https://api.openai.com";
      let apiKey = opts.apiKey || "";
      let defaultModel = opts.model || "gpt-4o";
      let models: string[] = [];
      const modelMappings: Record<string, string> = {};

      if (opts.profile) {
        ensureProfilesFile();
        const data = readJson<ProfilesData>(PROFILES_FILE);
        const p = data.profiles[opts.profile];
        if (!p) {
          throw new Error(`Profile '${opts.profile}' not found.`);
        }

        targetUrl = p.url || targetUrl;
        apiKey = p.token || apiKey;
        models = p.models || (p.model ? [p.model] : []);
        defaultModel = models[0] || defaultModel;

        models.forEach((m, i) => {
          if (!isAnthropicModel(m)) {
            const alias = ANTHROPIC_ALIASES[Math.min(i, ANTHROPIC_ALIASES.length - 1)];
            modelMappings[alias] = m;
          }
        });
      } else {
        for (const m of opts.mapping) {
          const [alias, actual] = m.split(":");
          if (alias && actual) {
            modelMappings[alias] = actual;
          }
        }
        models = [defaultModel];
      }

      const { baseUrl, stop } = await startOpenAIProxy(
        targetUrl,
        apiKey,
        defaultModel,
        models,
        modelMappings,
        "openai",
        getClaudeVersion(),
      );
      console.log(`Proxy running at ${baseUrl}`);
      console.log("Press Ctrl+C to stop");

      process.on("SIGINT", () => {
        stop();
        process.exit(0);
      });
    }));
}
