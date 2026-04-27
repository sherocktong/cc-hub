import { Command } from "commander";
import {
  PROFILES_FILE,
  CLAUDE_JSON,
  ensureProfilesFile,
  readJson,
  writeJson,
  fixJsonFile,
} from "../config.js";
import type { ProfilesData, Profile, ProviderType } from "../types.js";
import { createProfileSyncer } from "../platform/index.js";
import { execClaude } from "./runner.js";

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
    .action((name: string, opts: { model?: string[]; token?: string; url?: string; provider?: string }) => {
      const models = opts.model && opts.model.length > 0 ? opts.model : undefined;
      if (models && models.length > 3) {
        console.error("Error: A profile can have at most 3 models.");
        process.exit(1);
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
      syncer.sync(name, profile);
      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${name}' saved.`);
    });

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
    .action((name: string, opts: { model?: string[]; deleteModel?: string[]; token?: string; url?: string; provider?: string }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        console.error(`Profile '${name}' not found. Use 'profile add' to create it.`);
        process.exit(1);
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
        console.error("Error: A profile can have at most 3 models.");
        process.exit(1);
      }

      if (opts.token) p.token = opts.token;
      if (opts.url) p.url = opts.url;
      if (opts.provider) p.provider = opts.provider as ProviderType;

      syncer.sync(name, p);
      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${name}' updated.`);
    });

  // --- list ---
  profile
    .command("list")
    .description("List all profiles")
    .action(() => {
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
    });

  // --- view ---
  profile
    .command("view")
    .description("View full details of a profile (token unmasked)")
    .argument("<name>", "Profile name")
    .option("-j, --json", "Output as JSON")
    .action((name: string, opts: { json?: boolean }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const p = data.profiles[name];
      if (!p) {
        console.error(`Profile '${name}' not found.`);
        process.exit(1);
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
    });

  // --- remove ---
  profile
    .command("remove")
    .description("Remove a profile")
    .argument("<name>", "Profile name")
    .action((name: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        console.error(`Profile '${name}' not found.`);
        process.exit(1);
      }
      syncer.remove(name, data.profiles[name]);
      delete data.profiles[name];
      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${name}' removed.`);
    });

  // --- rename ---
  profile
    .command("rename")
    .description("Rename a profile")
    .argument("<oldName>", "Current profile name")
    .argument("<newName>", "New profile name")
    .action((oldName: string, newName: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[oldName]) {
        console.error(`Profile '${oldName}' not found.`);
        process.exit(1);
      }
      if (data.profiles[newName]) {
        console.error(`Profile '${newName}' already exists. Choose a different name.`);
        process.exit(1);
      }
      data.profiles[newName] = data.profiles[oldName];
      delete data.profiles[oldName];
      if (data.default === oldName) {
        data.default = newName;
      }
      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${oldName}' renamed to '${newName}'.`);
    });

  // --- default ---
  profile
    .command("default")
    .description("Set the default profile")
    .argument("<name>", "Profile name to set as default")
    .action((name: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        console.error(`Profile '${name}' not found.`);
        process.exit(1);
      }
      data.default = name;
      syncer.setActive(data.profiles[name]);
      writeJson(PROFILES_FILE, data);
      console.log(`Default profile set to '${name}'.`);
    });

  // --- sync ---
  profile
    .command("sync")
    .description("Synchronize all CLI profiles to the Claude desktop app")
    .action(() => {
      if (!syncer.isSupported()) {
        console.error("Claude desktop app is not installed.");
        process.exit(1);
      }

      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const names = Object.keys(data.profiles);

      if (names.length === 0) {
        console.log("No profiles to sync.");
        return;
      }

      for (const name of names) {
        const p = data.profiles[name];
        syncer.sync(name, p);
      }

      writeJson(PROFILES_FILE, data);
      console.log(`Synced ${names.length} profile(s) to the desktop app.`);
    });

  return profile;
}

export function useCommand(): Command {
  const syncer = createProfileSyncer();

  return new Command("use")
    .description("Set a profile as the default")
    .argument("<name>", "Profile name")
    .action((name: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        console.error(`Profile '${name}' not found.`);
        process.exit(1);
      }

      data.default = name;
      syncer.setActive(data.profiles[name]);
      writeJson(PROFILES_FILE, data);
      console.log(`Default profile set to '${name}'.`);
    });
}

export function runCommand(): Command {
  return new Command("run")
    .description("Launch Claude Code using the default or a specified profile")
    .allowUnknownOption()
    .argument("[args...]", "Optional profile name followed by extra arguments")
    .action((args: string[]) => {
      fixJsonFile(CLAUDE_JSON);

      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      let profileName = "";
      let claudeArgs: string[];

      if (args.length > 0 && data.profiles[args[0]]) {
        profileName = args[0];
        claudeArgs = args.slice(1);
      } else {
        profileName = data.default || "";
        claudeArgs = args;
      }

      if (!profileName) {
        console.error("No default profile set. Use 'cc-hub use <name>' first.");
        process.exit(1);
      }

      const p = data.profiles[profileName];
      execClaude(profileName, p, claudeArgs);
    });
}
