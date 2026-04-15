import { Command } from "commander";
import { spawnSync } from "node:child_process";
import {
  PROFILES_FILE,
  ensureProfilesFile,
  readJson,
  writeJson,
} from "./config.js";
import type { ProfilesData, Profile } from "./types.js";

function maskToken(token: string): string {
  if (!token) return "(unset)";
  if (token.length <= 12) return token;
  return token.slice(0, 8) + "..." + token.slice(-4);
}

export function profileCommand(): Command {
  const profile = new Command("profile")
    .description("Manage Claude CLI profiles");

  // --- add ---
  profile
    .command("add")
    .description("Add or update a profile")
    .argument("<name>", "Profile name")
    .option("-m, --model <model>", "Model ID (e.g. claude-opus-4-6)")
    .option("-t, --token <token>", "API key / token")
    .option("-u, --url <url>", "Base URL (e.g. https://api.anthropic.com)")
    .action((name: string, opts: { model?: string; token?: string; url?: string }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const profile = data.profiles[name] || {};
      if (opts.model) profile.model = opts.model;
      if (opts.token) profile.token = opts.token;
      if (opts.url) profile.url = opts.url;
      data.profiles[name] = profile;
      writeJson(PROFILES_FILE, data);
      console.log(`Profile '${name}' saved.`);
    });

  // --- update ---
  profile
    .command("update")
    .description("Update fields of an existing profile")
    .argument("<name>", "Profile name (must already exist)")
    .option("-m, --model <model>", "Model ID")
    .option("-t, --token <token>", "API key / token")
    .option("-u, --url <url>", "Base URL")
    .action((name: string, opts: { model?: string; token?: string; url?: string }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        console.error(`Profile '${name}' not found. Use 'profile add' to create it.`);
        process.exit(1);
      }
      const p = data.profiles[name];
      if (opts.model) p.model = opts.model;
      if (opts.token) p.token = opts.token;
      if (opts.url) p.url = opts.url;
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
      const fmt = (marker: string, name: string, model: string, token: string, url: string) =>
        `${marker.padEnd(2)}  ${name.padEnd(20)}  ${model.padEnd(30)}  ${token.padEnd(20)}  ${url}`;

      console.log(fmt("", "NAME", "MODEL", "TOKEN", "URL"));
      console.log(fmt("", "----", "-----", "-----", "---"));
      for (const name of names) {
        const p = profiles[name];
        const marker = name === def ? "* " : "  ";
        console.log(fmt(
          marker,
          name,
          p.model || "(unset)",
          maskToken(p.token || ""),
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
        console.log(`Name:   ${name}`);
        console.log(`Model:  ${p.model || "(unset)"}`);
        console.log(`Token:  ${p.token || "(unset)"}`);
        console.log(`URL:    ${p.url || "(default)"}`);
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

function execClaude(profileName: string, p: Profile, extraArgs: string[]): never {
  const cmd = ["claude"];
  if (p.model) cmd.push("--model", p.model);
  cmd.push(...extraArgs);

  const env: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: p.token || undefined,
    ANTHROPIC_BASE_URL: p.url || undefined,
  };
  // Remove ANTHROPIC_API_KEY so it doesn't conflict with ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_API_KEY;

  console.error(`Using profile '${profileName}': model=${p.model || "(default)"} url=${p.url || "(default)"}`);

  // Use spawn + inherit stdio so the interactive claude CLI works
  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env,
  });
  process.exit(result.status ?? 1);
}

// --- use ---
export function useCommand(): Command {
  return new Command("use")
    .description("Launch Claude Code with a saved profile (or set default if no args)")
    .allowUnknownOption()
    .argument("<name>", "Profile name")
    .argument("[args...]", "Extra arguments passed to claude")
    .action((name: string, args: string[]) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const p = data.profiles[name];
      if (!p) {
        console.error(`Profile '${name}' not found.`);
        process.exit(1);
      }

      // No extra args → just set as default
      if (!args || args.length === 0) {
        data.default = name;
        writeJson(PROFILES_FILE, data);
        console.log(`Default profile set to '${name}'.`);
        return;
      }

      execClaude(name, p, args);
    });
}

// --- run ---
export function runCommand(): Command {
  return new Command("run")
    .description("Launch Claude Code using the default or a specified profile")
    .allowUnknownOption()
    .argument("[args...]", "Optional profile name followed by extra arguments")
    .action((args: string[]) => {
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
