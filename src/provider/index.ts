import { Command } from "commander";
import { startOpenAIProxy } from "./server.js";

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
