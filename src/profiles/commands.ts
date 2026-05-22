import { Command } from "commander";
import {
  PROFILES_FILE,
  CLAUDE_DIR,
  CLAUDE_JSON,
  SETTINGS_FILE,
  ensureProfilesFile,
  ensureSettingsFile,
  readJson,
  writeJson,
  fixJsonFile,
} from "../config.js";
import path from "node:path";
import type { ProfilesData, Profile, ProviderType } from "../types.js";
import { createProfileSyncer } from "../platform/index.js";
import { execClaude, execClaudeBuiltIn, BUILT_IN_DEFAULT } from "./runner.js";
import { safeAction } from "../logger.js";
import * as logger from "../logger.js";
import { isAnthropicModel } from "../provider/index.js";

function maskToken(token: string): string {
  if (!token) return "(unset)";
  if (token.length <= 12) return token;
  return token.slice(0, 8) + "..." + token.slice(-4);
}

function formatModels(p: Profile): string {
  if (p.models && p.models.length > 0) {
    const nonAnthropicModels = p.models.filter(m => !isAnthropicModel(m));
    const parts: string[] = [];

    p.models.forEach((m, i) => {
      if (!isAnthropicModel(m)) {
        const aliasIndex = nonAnthropicModels.indexOf(m);
        if (aliasIndex === 0) parts.push(`${m} (sonnet)`);
        else if (aliasIndex === 1) parts.push(`${m} (opus)`);
        else if (aliasIndex === 2) parts.push(`${m} (haiku)`);
        else parts.push(m);
      } else {
        parts.push(m);
      }
    });

    const joined = parts.join(", ");
    if (joined.length > 28) {
      return parts[0] + ", +" + (parts.length - 1) + " more";
    }
    return joined;
  }
  return p.model || "(unset)";
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function profileCommand(): Command {
  const profile = new Command("profile")
    .description("Manage Claude CLI profiles");

  const syncer = createProfileSyncer();

  // --- add ---
  profile
    .command("add")
    .description("Add or update a profile")
    .argument("<name>", "Profile name")
    .option("-m, --model <model>", "Model ID - can be used multiple times (max 3)", collect, [])
    .option("-t, --token <token>", "API key / token")
    .option("-u, --url <url>", "Base URL")
    .option("-p, --provider <provider>", "Provider type: anthropic (default) or openai")
    .action(safeAction((name: string, opts: { model?: string[]; token?: string; url?: string; provider?: string }) => {
      const models = opts.model && opts.model.length > 0 ? opts.model : undefined;
      if (models && models.length > 3) {
        throw new Error("Error: A profile can have at most 3 models.");
      }

      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const profile = data.profiles[name] || {};

      if (models) {
        profile.models = models;
        profile.model = models[0];
      }
      if (opts.token) profile.token = opts.token;
      if (opts.url) profile.url = opts.url;
      if (opts.provider) profile.provider = opts.provider as ProviderType;

      data.profiles[name] = profile;
      logger.debug(`profile add: syncing profile '${name}' to desktop`);
      syncer.sync(name, profile);
      writeJson(PROFILES_FILE, data);
      logger.debug(`profile add: wrote ${PROFILES_FILE}`);
      console.log(`Profile '${name}' saved.`);
    }));

  // --- update ---
  profile
    .command("update")
    .description("Update fields of an existing profile")
    .argument("<name>", "Profile name (must already exist)")
    .option("-m, --model <model>", "Model ID - can be used multiple times", collect, [])
    .option("-d, --delete-model <model>", "Remove model ID - can be used multiple times", collect, [])
    .option("-t, --token <token>", "API key / token")
    .option("-u, --url <url>", "Base URL")
    .option("-p, --provider <provider>", "Provider type")
    .action(safeAction((name: string, opts: { model?: string[]; deleteModel?: string[]; token?: string; url?: string; provider?: string }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        throw new Error(`Profile '${name}' not found. Use 'profile add' to create it.`);
      }
      const p = data.profiles[name];

      const providedModels = opts.model && opts.model.length > 0 ? opts.model : undefined;
      const modelsToDelete = opts.deleteModel && opts.deleteModel.length > 0 ? opts.deleteModel : undefined;

      if (modelsToDelete) {
        const toRemove = new Set(modelsToDelete);
        const currentModels = p.models || (p.model ? [p.model] : []);
        const newModels = currentModels.filter(m => !toRemove.has(m));
        const removedCount = currentModels.length - newModels.length;

        if (removedCount === 0) {
          console.log(`No matching models to remove from profile '${name}'.`);
        } else if (newModels.length === 0) {
          delete p.models;
          delete p.model;
          console.log(`Removed all models from profile '${name}'.`);
        } else {
          p.models = newModels;
          p.model = newModels[0];
          console.log(`Removed ${removedCount} model(s) from profile '${name}'.`);
        }
      }

      if (providedModels) {
        if (providedModels.length === 1) {
          const modelToSet = providedModels[0];
          const currentModels = p.models || (p.model ? [p.model] : []);
          const existingIndex = currentModels.indexOf(modelToSet);

          if (existingIndex !== -1) {
            currentModels.splice(existingIndex, 1);
            currentModels.unshift(modelToSet);
            p.models = currentModels;
            p.model = modelToSet;
            console.log(`Selected existing model '${modelToSet}' (position ${existingIndex + 1} -> 1).`);
          } else {
            currentModels.unshift(modelToSet);
            p.models = currentModels;
            p.model = modelToSet;
            console.log(`Added and selected new model '${modelToSet}'.`);
          }
        } else {
          p.models = providedModels;
          p.model = providedModels[0];
        }
      }

      const finalModels = p.models || (p.model ? [p.model] : []);
      if (finalModels.length > 3) {
        throw new Error("Error: A profile can have at most 3 models.");
      }

      if (opts.token) p.token = opts.token;
      if (opts.url) p.url = opts.url;
      if (opts.provider) p.provider = opts.provider as ProviderType;

      logger.debug(`profile update: syncing profile '${name}' to desktop`);
      syncer.sync(name, p);
      writeJson(PROFILES_FILE, data);
      logger.debug(`profile update: wrote ${PROFILES_FILE}`);
      console.log(`Profile '${name}' updated.`);
    }));

  // --- list ---
  profile
    .command("list")
    .description("List all profiles")
    .action(safeAction(() => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const profiles = data.profiles;
      const names = Object.keys(profiles);
      if (names.length === 0) {
        console.log("No profiles defined. Use 'profile add' to create one.");
        return;
      }
      const def = data.default || "";
      const fmt = (marker: string, name: string, model: string, token: string, provider: string, url: string) =>
        `${marker.padEnd(2)}  ${name.padEnd(20)}  ${model.padEnd(30)}  ${token.padEnd(20)}  ${provider.padEnd(12)}  ${url}`;

      console.log(fmt("", "NAME", "MODEL(S)", "TOKEN", "PROVIDER", "URL"));
      console.log(fmt("", "----", "--------", "-----", "--------", "---"));
      for (const name of names) {
        const p = profiles[name];
        const marker = name === def ? "* " : "  ";
        const desktopMarker = p.desktopId ? " [desktop]" : "";
        const displayName = (name + desktopMarker).padEnd(20);
        console.log(fmt(
          marker,
          displayName,
          formatModels(p),
          maskToken(p.token || ""),
          p.provider || "anthropic",
          p.url || "(default)",
        ));
      }
    }));

  // --- view ---
  profile
    .command("view")
    .description("View full details of a profile (token unmasked)")
    .argument("<name>", "Profile name")
    .option("-j, --json", "Output as JSON")
    .action(safeAction((name: string, opts: { json?: boolean }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      if (name === BUILT_IN_DEFAULT) {
        throw new Error(`'${BUILT_IN_DEFAULT}' is not a stored profile. Use 'cc-hub run --built-in' or 'cc-hub use --built-in' for official Anthropic models.`);
      }

      const p = data.profiles[name];
      if (!p) {
        throw new Error(`Profile '${name}' not found.`);
      }
      if (opts.json) {
        const { desktopId, ...rest } = p;
        console.log(JSON.stringify({ name, ...rest }, null, 2));
      } else {
        console.log(`Name:     ${name}`);
        console.log(`Model:    ${p.model || "(unset)"}`);
        if (p.models && p.models.length > 0) {
          const nonAnthropicModels = p.models.filter(m => !isAnthropicModel(m));
          console.log(`Models:`);
          for (const m of p.models) {
            if (!isAnthropicModel(m)) {
              const aliasIndex = nonAnthropicModels.indexOf(m);
              let alias = "";
              if (aliasIndex === 0) alias = " (sonnet)";
              else if (aliasIndex === 1) alias = " (opus)";
              else if (aliasIndex === 2) alias = " (haiku)";
              console.log(`  - ${m}${alias}`);
            } else {
              console.log(`  - ${m}`);
            }
          }
        }
        console.log(`Token:    ${p.token || "(unset)"}`);
        console.log(`URL:      ${p.url || "(default)"}`);
        console.log(`Provider: ${p.provider || "anthropic"}`);
      }
    }));

  // --- remove ---
  profile
    .command("remove")
    .description("Remove a profile")
    .argument("<name>", "Profile name")
    .action(safeAction((name: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        throw new Error(`Profile '${name}' not found.`);
      }
      logger.debug(`profile remove: removing profile '${name}' from desktop sync`);
      syncer.remove(name, data.profiles[name]);
      delete data.profiles[name];
      writeJson(PROFILES_FILE, data);
      logger.debug(`profile remove: wrote ${PROFILES_FILE}`);
      console.log(`Profile '${name}' removed.`);
    }));

  // --- rename ---
  profile
    .command("rename")
    .description("Rename a profile")
    .argument("<oldName>", "Current profile name")
    .argument("<newName>", "New profile name")
    .action(safeAction((oldName: string, newName: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[oldName]) {
        throw new Error(`Profile '${oldName}' not found.`);
      }
      if (data.profiles[newName]) {
        throw new Error(`Profile '${newName}' already exists. Choose a different name.`);
      }
      data.profiles[newName] = data.profiles[oldName];
      delete data.profiles[oldName];
      if (data.default === oldName) {
        data.default = newName;
      }
      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${oldName}' renamed to '${newName}'.`);
    }));

  // --- default ---
  profile
    .command("default")
    .description("Set the default profile")
    .option("--built-in", "Use official Anthropic models as default")
    .argument("[name]", "Profile name to set as default (required unless --built-in)")
    .action(safeAction((name: string | undefined, opts: { builtIn?: boolean }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      if (opts.builtIn) {
        data.default = BUILT_IN_DEFAULT;
        writeJson(PROFILES_FILE, data);
        logger.debug(`profile default: wrote ${PROFILES_FILE}`);
        console.log("Default set to built-in official Anthropic models.");
        return;
      }

      if (!name) {
        throw new Error("Profile name is required. Use --built-in for official Anthropic models.");
      }

      if (!data.profiles[name]) {
        throw new Error(`Profile '${name}' not found.`);
      }
      data.default = name;
      logger.debug(`profile default: setting active desktop profile to '${name}'`);
      syncer.setActive(data.profiles[name]);
      writeJson(PROFILES_FILE, data);
      logger.debug(`profile default: wrote ${PROFILES_FILE}`);
      console.log(`Default profile set to '${name}'.`);
    }));

  // --- sync ---
  profile
    .command("sync")
    .description("Synchronize all CLI profiles to the Claude desktop app")
    .action(safeAction(() => {
      if (!syncer.isSupported()) {
        throw new Error("Claude desktop app is not installed.");
      }

      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const names = Object.keys(data.profiles);

      if (names.length === 0) {
        console.log("No profiles to sync.");
        return;
      }

      for (const name of names) {
        if (name === BUILT_IN_DEFAULT) continue;
        const p = data.profiles[name];
        logger.debug(`profile sync: syncing '${name}' to desktop`);
        syncer.sync(name, p);
      }

      writeJson(PROFILES_FILE, data);
      logger.debug(`profile sync: wrote ${PROFILES_FILE}`);
      console.log(`Synced ${names.length} profile(s) to the desktop app.`);
    }));

  // --- export ---
  profile
    .command("export")
    .description("Export a profile to a settings file")
    .argument("<name>", "Profile name")
    .action(safeAction((name: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const p = data.profiles[name];
      if (!p) {
        throw new Error(`Profile '${name}' not found.`);
      }

      ensureSettingsFile();
      const settings = readJson<SettingsData>(SETTINGS_FILE);

      const exported: SettingsData = Object.fromEntries(
        Object.entries(settings).filter(([key]) => !key.startsWith("_"))
      ) as SettingsData;
      const env: Record<string, string> = {
        ...(typeof exported.env === "object" && exported.env !== null
          ? (exported.env as Record<string, string>)
          : {}),
      };

      if (p.token) env.ANTHROPIC_AUTH_TOKEN = p.token;
      if (p.url) env.ANTHROPIC_BASE_URL = p.url;

      const models = p.models || (p.model ? [p.model] : []);
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
      }

      env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1";
      env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";

      exported.env = env;

      const exportPath = path.join(CLAUDE_DIR, `settings.${name}.json`);
      writeJson(exportPath, exported);
      console.log(`Profile '${name}' exported to ${exportPath}`);
    }));

  return profile;
}

export function useCommand(): Command {
  const syncer = createProfileSyncer();

  return new Command("use")
    .description("Set a profile as the default")
    .option("--built-in", "Use official Anthropic models as default")
    .argument("[name]", "Profile name (required unless --built-in)")
    .action(safeAction((name: string | undefined, opts: { builtIn?: boolean }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      if (opts.builtIn) {
        data.default = BUILT_IN_DEFAULT;
        writeJson(PROFILES_FILE, data);
        logger.debug(`use: wrote ${PROFILES_FILE}`);
        console.log("Default set to built-in official Anthropic models.");
        return;
      }

      if (!name) {
        throw new Error("Profile name is required. Use --built-in for official Anthropic models.");
      }

      if (!data.profiles[name]) {
        throw new Error(`Profile '${name}' not found.`);
      }

      data.default = name;
      logger.debug(`use: setting active desktop profile to '${name}'`);
      syncer.setActive(data.profiles[name]);
      writeJson(PROFILES_FILE, data);
      logger.debug(`use: wrote ${PROFILES_FILE}`);
      console.log(`Default profile set to '${name}'.`);
    }));
}

export function runCommand(): Command {
  return new Command("run")
    .description("Launch Claude Code using the default or a specified profile")
    .option("--built-in", "Use official Anthropic models (no custom profile)")
    .allowUnknownOption()
    .argument("[args...]", "Optional profile name followed by extra arguments")
    .action(safeAction((args: string[], opts: { builtIn?: boolean }) => {
      fixJsonFile(CLAUDE_JSON);

      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      if (opts.builtIn) {
        execClaudeBuiltIn(args);
        return;
      }

      let profileName = "";
      let claudeArgs: string[];

      if (args.length > 0 && data.profiles[args[0]]) {
        profileName = args[0];
        claudeArgs = args.slice(1);
      } else {
        profileName = data.default || "";
        claudeArgs = args;
      }

      if (profileName === BUILT_IN_DEFAULT) {
        execClaudeBuiltIn(claudeArgs);
        return;
      }

      if (!profileName) {
        throw new Error("No default profile set. Use 'cc-hub use <name>' or 'cc-hub use --built-in' first.");
      }

      const p = data.profiles[profileName];
      logger.debug(`run: launching claude with profile '${profileName}', args=[${claudeArgs.join(", ")}]`);
      execClaude(profileName, p, claudeArgs);
    }));
}
