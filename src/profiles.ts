import { Command } from "commander";
import { spawnSync, spawn } from "node:child_process";
import {
  PROFILES_FILE,
  SETTINGS_FILE,
  CLAUDE_JSON,
  ensureProfilesFile,
  ensureSettingsFile,
  readJson,
  fixJsonFile,
  writeJson,
} from "./config.js";
import type { ProfilesData, Profile, SettingsData, ProviderType } from "./types.js";
import { startOpenAIProxy } from "./provider.js";

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
        // Non-Anthropic model - show with alias
        const aliasIndex = nonAnthropicModels.indexOf(m);
        if (aliasIndex === 0) parts.push(`${m} (opus)`);
        else if (aliasIndex === 1) parts.push(`${m} (sonnet)`);
        else if (aliasIndex === 2) parts.push(`${m} (haiku)`);
        else parts.push(m);
      } else {
        // Anthropic model - show as-is
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

function updateSettingsForProfile(p: Profile): void {
  ensureSettingsFile();
  const settings = readJson<SettingsData>(SETTINGS_FILE);
  const models = p.models || (p.model ? [p.model] : []);
  const nonAnthropicModels = models.filter(m => !isAnthropicModel(m));

  if (models.length > 0) {
    settings.model = models[0];

    // If there are non-Anthropic models, use aliases in availableModels
    // since we're mapping them via ANTHROPIC_DEFAULT_*_MODEL env vars at runtime
    if (nonAnthropicModels.length > 0) {
    const aliases: string[] = [];
      if (nonAnthropicModels[0]) aliases.push("opus");
      if (nonAnthropicModels[1]) aliases.push("sonnet");
      if (nonAnthropicModels[2]) aliases.push("haiku");
    settings.availableModels = aliases;
    } else {
      // Pure Anthropic models - use actual model IDs
      settings.availableModels = models;
    }
  } else {
    delete settings.model;
    delete settings.availableModels;
  }

  // Clean up old model env vars (runtime ones are set in execClaude)
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
    for (const key of envVarsToClean) {
      delete settings.env[key];
    }
  }

  writeJson(SETTINGS_FILE, settings);
}

export function profileCommand(): Command {
  const profile = new Command("profile")
    .description("Manage Claude CLI profiles");

  // --- add ---
  profile
    .command("add")
    .description("Add or update a profile")
    .argument("<name>", "Profile name")
    .option("-m, --model <model>", "Model ID (e.g. claude-opus-4-6) - can be used multiple times", collect, [])
    .option("-t, --token <token>", "API key / token")
    .option("-u, --url <url>", "Base URL (e.g. https://api.anthropic.com)")
    .option("-p, --provider <provider>", "Provider type: anthropic (default) or openai")
    .action((name: string, opts: { model?: string[]; token?: string; url?: string; provider?: string }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const profile = data.profiles[name] || {};

      const models = opts.model && opts.model.length > 0 ? opts.model : undefined;
      if (models) {
        profile.models = models;
        profile.model = models[0];
      }
      if (opts.token) profile.token = opts.token;
      if (opts.url) profile.url = opts.url;
      if (opts.provider) profile.provider = opts.provider as ProviderType;

      data.profiles[name] = profile;
      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${name}' saved.`);
    });

  // --- update ---
  profile
    .command("update")
    .description("Update fields of an existing profile")
    .argument("<name>", "Profile name (must already exist)")
    .option("-m, --model <model>", "Model ID - can be used multiple times to set multiple models", collect, [])
    .option("-d, --delete-model <model>", "Remove model ID - can be used multiple times", collect, [])
    .option("-t, --token <token>", "API key / token")
    .option("-u, --url <url>", "Base URL")
    .option("-p, --provider <provider>", "Provider type: anthropic (default) or openai")
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
          // Single model: check if exists, select it; otherwise add it
          const modelToSet = providedModels[0];
          const currentModels = p.models || (p.model ? [p.model] : []);
          const existingIndex = currentModels.indexOf(modelToSet);

          if (existingIndex !== -1) {
            // Model exists: move it to first position
            currentModels.splice(existingIndex, 1);
            currentModels.unshift(modelToSet);
            p.models = currentModels;
            p.model = modelToSet;
            console.log(`Selected existing model '${modelToSet}' (position ${existingIndex + 1} -> 1).`);
          } else {
            // Model doesn't exist: add it to the list
            currentModels.unshift(modelToSet);
            p.models = currentModels;
            p.model = modelToSet;
            console.log(`Added and selected new model '${modelToSet}'.`);
          }
        } else {
          // Multiple models: replace the entire list
          p.models = providedModels;
          p.model = providedModels[0];
        }
      }

      if (opts.token) p.token = opts.token;
      if (opts.url) p.url = opts.url;
      if (opts.provider) p.provider = opts.provider as ProviderType;

      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${name}' updated.`);
    });

  // --- remove-model ---
  profile
    .command("remove-model")
    .description("Remove specific models from a profile")
    .argument("<name>", "Profile name")
    .option("-m, --model <model>", "Model ID to remove - can be used multiple times", collect, [])
    .action((name: string, opts: { model: string[] }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        console.error(`Profile '${name}' not found.`);
        process.exit(1);
      }

      const p = data.profiles[name];
      const toRemove = new Set(opts.model);

      if (toRemove.size === 0) {
        console.error("No models specified to remove. Use -m <model> to specify models.");
        process.exit(1);
      }

      const currentModels = p.models || (p.model ? [p.model] : []);
      const newModels = currentModels.filter(m => !toRemove.has(m));

      if (newModels.length === 0) {
        delete p.models;
        delete p.model;
        console.log(`Removed all models from profile '${name}'.`);
      } else {
        const removedCount = currentModels.length - newModels.length;
        p.models = newModels;
        p.model = newModels[0];
        console.log(`Removed ${removedCount} model(s) from profile '${name}'.`);
        console.log(`Remaining models: ${newModels.join(", ")}`);
      }

      writeJson(PROFILES_FILE, data);
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
        console.log(fmt(
          marker,
          name,
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
        console.log(JSON.stringify({ name, ...p }, null, 2));
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
              if (aliasIndex === 0) alias = " (opus)";
              else if (aliasIndex === 1) alias = " (sonnet)";
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
      delete data.profiles[name];
      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${name}' removed.`);
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
      writeJson(PROFILES_FILE, data);
      console.log(`Default profile set to '${name}'.`);
    });

  return profile;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function execClaude(profileName: string, p: Profile, extraArgs: string[]): never {
  // Update settings.json with models from profile (includes env vars)
  updateSettingsForProfile(p);

  const models = p.models || (p.model ? [p.model] : []);
  const firstModel = models[0];

  const cmd = ["claude"];
  if (firstModel) cmd.push("--model", firstModel);
  cmd.push(...extraArgs);

  // Pass auth credentials to spawned process
  const env: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: p.token || undefined,
    ANTHROPIC_BASE_URL: p.url || undefined,
  };

  // Set up model alias env vars for non-Anthropic models
  const nonAnthropicModels = models.filter(m => !isAnthropicModel(m));
  if (nonAnthropicModels.length > 0) {
    if (nonAnthropicModels[0]) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = nonAnthropicModels[0];
      env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = nonAnthropicModels[0];
      env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION = `Custom: ${nonAnthropicModels[0]}`;
    }
    if (nonAnthropicModels[1]) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = nonAnthropicModels[1];
      env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = nonAnthropicModels[1];
      env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION = `Custom: ${nonAnthropicModels[1]}`;
    }
    if (nonAnthropicModels[2]) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = nonAnthropicModels[2];
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = nonAnthropicModels[2];
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION = `Custom: ${nonAnthropicModels[2]}`;
    }
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = nonAnthropicModels[0];
  }

  // Remove ANTHROPIC_API_KEY so it doesn't conflict with ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_API_KEY;

  console.error(`Using profile '${profileName}': model=${firstModel || "(default)"} url=${p.url || "(default)"} provider=${p.provider || "anthropic"}`);

  if (p.provider === "openai") {
    const allModels = p.models || (p.model ? [p.model] : []);

    startOpenAIProxy(
      p.url || "https://api.openai.com",
      p.token || "",
      firstModel || "gpt-4o",
      allModels,
    ).then(({ baseUrl, stop }) => {
      env.ANTHROPIC_BASE_URL = baseUrl;
      // Keep ANTHROPIC_AUTH_TOKEN so Claude Code thinks it's authenticated
      // The proxy will override with its own auth header

      const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env });
      child.on("close", (code) => {
        stop();
        process.exit(code ?? 1);
      });
    }).catch((err) => {
      console.error("Failed to start OpenAI proxy:", err);
      process.exit(1);
    });
  } else {
    // Use spawn + inherit stdio so the interactive claude CLI works
    const result = spawnSync(cmd[0], cmd.slice(1), {
      stdio: "inherit",
      env,
    });
    process.exit(result.status ?? 1);
  }
}

// --- use ---
export function useCommand(): Command {
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
      writeJson(PROFILES_FILE, data);
      console.log(`Default profile set to '${name}'.`);
    });
}

// --- run ---
export function runCommand(): Command {
  return new Command("run")
    .description("Launch Claude Code using the default or a specified profile")
    .allowUnknownOption()
    .argument("[args...]", "Optional profile name followed by extra arguments")
    .action((args: string[]) => {
      // Fix ~/.claude.json if corrupt before launching Claude
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
