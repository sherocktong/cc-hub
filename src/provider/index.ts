import { Command } from "commander";
import { startOpenAIProxy } from "./server.js";
import { safeAction } from "../logger.js";
import { ensureProfilesFile, readJson, PROFILES_FILE } from "../config.js";
import type { ProfilesData } from "../types.js";

export {
  sanitizeToolId,
  transformAnthropicToOpenAI,
  transformOpenAIResponseToAnthropic,
  synthesizeAnthropicSSE,
} from "./transform.js";

export { startOpenAIProxy } from "./server.js";

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

const ANTHROPIC_ALIASES = ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"];

function isAnthropicModel(model: string): boolean {
  const anthropicAliases = ["opus", "sonnet", "haiku", "best", "default", "opusplan", "opus[1m]", "sonnet[1m]"];
  const lower = model.toLowerCase();
  if (anthropicAliases.includes(lower)) return true;
  if (lower.startsWith("claude-")) return true;
  return false;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function providerCommand(): Command {
  const cmd = new Command("provider").description("Manage provider types");

  cmd
    .command("list")
    .description("List available provider types")
    .action(safeAction(() => {
      const fmt = (name: string, desc: string) =>
        `${name.padEnd(12)}  ${desc}`;
      console.log(fmt("NAME", "DESCRIPTION"));
      console.log(fmt("----", "-----------"));
      for (const p of PROVIDERS) {
        console.log(fmt(p.name, p.description));
      }
    }));

  return cmd;
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

      const { baseUrl, stop } = await startOpenAIProxy(targetUrl, apiKey, defaultModel, models, modelMappings);
      console.log(`Proxy running at ${baseUrl}`);
      console.log("Press Ctrl+C to stop");

      process.on("SIGINT", () => {
        stop();
        process.exit(0);
      });
    }));
}
