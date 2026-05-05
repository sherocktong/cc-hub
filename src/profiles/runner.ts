import { spawnSync, spawn } from "node:child_process";
import {
  SETTINGS_FILE,
  CLAUDE_JSON,
  ensureSettingsFile,
  readJson,
  fixJsonFile,
  writeJson,
} from "../config.js";
import type { Profile, SettingsData } from "../types.js";
import { startOpenAIProxy } from "../provider/index.js";
import { createBinaryResolver } from "../platform/index.js";
import * as logger from "../logger.js";

export const BUILT_IN_DEFAULT = "__builtin__";

export function resolveClaudeBinary(): string {
  return createBinaryResolver().resolve();
}

function updateSettingsForProfile(p: Profile): void {
  logger.debug(`updateSettingsForProfile: reading ${SETTINGS_FILE}`);
  ensureSettingsFile();
  const settings = readJson<SettingsData>(SETTINGS_FILE);
  const models = p.models || (p.model ? [p.model] : []);

  delete settings.model;
  delete settings.availableModels;

  const envVarsToClean = [
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
    "ANTHROPIC_CUSTOM_MODEL_OPTION",
  ];
  if (settings.env) {
    const env = settings.env as Record<string, unknown>;
    for (const key of envVarsToClean) {
      delete env[key];
    }
  }

  writeJson(SETTINGS_FILE, settings);
  logger.debug(`updateSettingsForProfile: wrote ${SETTINGS_FILE}`);
}

export function execClaude(profileName: string, p: Profile, extraArgs: string[]): void {
  updateSettingsForProfile(p);

  const models = p.models || (p.model ? [p.model] : []);
  const firstModel = models[0];

  const binary = resolveClaudeBinary();
  const cmd = [binary];
  if (firstModel) cmd.push("--model", firstModel);
  cmd.push(...extraArgs);

  const env: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: p.token || undefined,
    ANTHROPIC_BASE_URL: p.url || undefined,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
  };

  if (models.length > 0) {
    if (models[0]) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = models[0];
      env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = models[0];
      env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION = `Custom: ${models[0]}`;
    }
    if (models[1]) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = models[1];
      env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = models[1];
      env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION = `Custom: ${models[1]}`;
    }
    if (models[2]) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = models[2];
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = models[2];
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION = `Custom: ${models[2]}`;
    }
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = models[0];
  }

  delete env.ANTHROPIC_API_KEY;

  logger.info(`Launching Claude with profile '${profileName}': model=${firstModel || "(default)"} url=${p.url || "(default)"} provider=${p.provider || "anthropic"} binary=${binary}`);

  if (p.provider === "openai") {
    const allModels = p.models || (p.model ? [p.model] : []);
    logger.debug(`execClaude: starting OpenAI proxy for ${allModels.length} model(s)`);

    startOpenAIProxy(
      p.url || "https://api.openai.com",
      p.token || "",
      firstModel || "gpt-4o",
      allModels,
    ).then(({ baseUrl, stop }) => {
      env.ANTHROPIC_BASE_URL = baseUrl;
      logger.debug(`execClaude: proxy running at ${baseUrl}`);

      const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env, shell: process.platform === "win32" });
      child.on("close", (code) => {
        stop();
        process.exit(code ?? 1);
      });
    }).catch((err) => {
      logger.error("Failed to start OpenAI proxy", err);
      console.error("Failed to start OpenAI proxy:", err);
      process.exit(1);
    });
  } else {
    const result = spawnSync(cmd[0], cmd.slice(1), {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
    process.exit(result.status ?? 1);
  }
}

export function execClaudeBuiltIn(extraArgs: string[]): void {
  const binary = resolveClaudeBinary();
  const cmd = [binary, ...extraArgs];

  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
  };

  logger.info(`Launching Claude with built-in official models: binary=${binary}`);

  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}
