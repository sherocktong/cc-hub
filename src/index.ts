import { Command } from "commander";
import { profileCommand, useCommand, runCommand } from "./profiles.js";
import { hooksCommand } from "./hooks.js";
import { sessionCommand } from "./sessions.js";
import { completeCommand } from "./complete.js";

const program = new Command();

program
  .name("cc-hub")
  .description("Manage Claude CLI profiles, hooks, and sessions")
  .version("1.0.0");

program.addCommand(profileCommand());
program.addCommand(useCommand());
program.addCommand(runCommand());
program.addCommand(hooksCommand());
program.addCommand(sessionCommand());
program.addCommand(completeCommand());

program.parse();
