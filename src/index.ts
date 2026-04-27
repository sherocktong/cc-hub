import { Command } from "commander";
import { createRequire } from "module";
import { profileCommand, useCommand, runCommand } from "./profiles/index.js";
import { hooksCommand } from "./hooks/index.js";
import { sessionCommand } from "./sessions/index.js";
import { completeCommand } from "./complete/index.js";
import { providerCommand } from "./provider/index.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

const program = new Command();

program
  .name("cc-hub")
  .description("Manage Claude CLI profiles, hooks, and sessions")
  .version(version);

program.addCommand(profileCommand());
program.addCommand(useCommand());
program.addCommand(runCommand());
program.addCommand(hooksCommand());
program.addCommand(sessionCommand());
program.addCommand(completeCommand());
program.addCommand(providerCommand());

program.parse();
