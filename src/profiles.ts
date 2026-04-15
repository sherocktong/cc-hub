import { Command } from "commander";
import Anthropic from "@anthropic-ai/sdk";
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

async function runWithProfile(profileName: string, prompt: string): Promise<void> {
  ensureProfilesFile();
  const data = readJson<ProfilesData>(PROFILES_FILE);
  const p = data.profiles[profileName];
  if (!p) {
    console.error(`Profile '${profileName}' not found.`);
    process.exit(1);
  }
  if (!p.token) {
    console.error(`Profile '${profileName}' has no token configured.`);
    process.exit(1);
  }

  const client = new Anthropic({
    apiKey: p.token,
    ...(p.url ? { baseURL: p.url } : {}),
  });

  console.error(`Using profile '${profileName}': model=${p.model || "(default)"} url=${p.url || "(default)"}`);

  const stream = client.messages.stream(
    {
      model: p.model || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
    }
  }
  process.stdout.write("\n");
}

// --- use ---
export function useCommand(): Command {
  return new Command("use")
    .description("Launch a chat session using a saved profile")
    .argument("<name>", "Profile name")
    .argument("[prompt...]", "Prompt text")
    .action(async (name: string, promptParts: string[]) => {
      const prompt = promptParts.join(" ");
      if (!prompt) {
        // No prompt — just set as default
        ensureProfilesFile();
        const data = readJson<ProfilesData>(PROFILES_FILE);
        if (!data.profiles[name]) {
          console.error(`Profile '${name}' not found.`);
          process.exit(1);
        }
        data.default = name;
        writeJson(PROFILES_FILE, data);
        console.log(`Default profile set to '${name}'.`);
        return;
      }
      await runWithProfile(name, prompt);
    });
}

// --- run ---
export function runCommand(): Command {
  return new Command("run")
    .description("Run a prompt using the default or a specified profile")
    .argument("[args...]", "Optional profile name followed by prompt")
    .action(async (args: string[]) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      let profileName = "";
      let promptParts: string[];

      if (args.length > 0 && data.profiles[args[0]]) {
        profileName = args[0];
        promptParts = args.slice(1);
      } else {
        profileName = data.default || "";
        promptParts = args;
      }

      if (!profileName) {
        console.error("No default profile set. Use 'cc-hub use <name>' first.");
        process.exit(1);
      }

      const prompt = promptParts.join(" ");
      if (!prompt) {
        console.error("No prompt provided.");
        process.exit(1);
      }
      await runWithProfile(profileName, prompt);
    });
}
