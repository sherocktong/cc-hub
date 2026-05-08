import { Command } from "commander";
import { createRequire } from "module";
import { profileCommand, useCommand, runCommand } from "./profiles/index.js";
import { hooksCommand } from "./hooks/index.js";
import { sessionCommand } from "./sessions/index.js";
import { completionCommand } from "./complete/index.js";
import { providerCommand, proxyCommand } from "./provider/index.js";
import { installGlobalExceptionHandlers, setLogLevel } from "./logger.js";
import { SETTINGS_FILE, ensureSettingsFile, readJson } from "./config.js";
import type { SettingsData } from "./types.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

// Load log level from settings before any logging occurs
ensureSettingsFile();
const settings = readJson<SettingsData>(SETTINGS_FILE);
setLogLevel(settings._cc_hub_logLevel || "INFO");

installGlobalExceptionHandlers();

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
program.addCommand(completionCommand());
program.addCommand(providerCommand());
program.addCommand(proxyCommand());

try {
  program.parse();
} catch (err) {
  console.error("Unexpected error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
