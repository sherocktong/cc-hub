import { Command } from "commander";
import { safeAction } from "../logger.js";

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

export const ANTHROPIC_ALIASES = ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"];

export function isAnthropicModel(model: string): boolean {
  const anthropicAliases = ["opus", "sonnet", "haiku", "best", "default", "opusplan", "opus[1m]", "sonnet[1m]"];
  const lower = model.toLowerCase();
  if (anthropicAliases.includes(lower)) return true;
  if (lower.startsWith("claude-")) return true;
  for (let index = 0; index < anthropicAliases.length; index++) {
    const element = anthropicAliases[index];
    if (lower.includes(element)) return true;
  }
  return false;
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
