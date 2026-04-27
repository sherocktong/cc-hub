import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";

let tmpDir: string;

function setup() {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hub-profile-test-"));
  process.env.CLAUDE_DIR = tmpDir;
  process.env.CLAUDE_PROFILES_FILE = path.join(tmpDir, "profiles.json");
  process.env.CLAUDE_SETTINGS_FILE = path.join(tmpDir, "settings.json");
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CLAUDE_DIR;
  delete process.env.CLAUDE_PROFILES_FILE;
  delete process.env.CLAUDE_SETTINGS_FILE;
}

// Helper: run a Commander command and capture stdout/stderr
async function runCommand(cmd: Command, args: string[]) {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => errors.push(a.join(" "));

  const exitCode = await new Promise<number>((resolve) => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      resolve(typeof code === "number" ? code : 1);
      throw new Error(`process.exit(${code})`);
    });
    try {
      cmd.parse(["node", "cc-hub", ...args]);
      resolve(0);
    } catch {
      // swallow the process.exit() throw
    } finally {
      exitSpy.mockRestore();
    }
  });

  console.log = origLog;
  console.error = origError;
  return { logs, errors, exitCode };
}

async function getProfileCommand() {
  const mod = await import("../../src/profiles/index.js");
  return mod.profileCommand();
}

// ---------------------------------------------------------------------------
// profile add
// ---------------------------------------------------------------------------

describe("profile add", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("creates a new profile with model and token", async () => {
    const cmd = await getProfileCommand();
    await runCommand(cmd, ["add", "dev", "-m", "claude-opus-4-7", "-t", "sk-test-123"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["dev"]).toMatchObject({
      model: "claude-opus-4-7",
      models: ["claude-opus-4-7"],
      token: "sk-test-123",
    });
  });

  it("creates a profile with multiple models", async () => {
    const cmd = await getProfileCommand();
    await runCommand(cmd, ["add", "multi", "-m", "claude-opus-4-7", "-m", "claude-sonnet-4-6"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["multi"].models).toEqual(["claude-opus-4-7", "claude-sonnet-4-6"]);
  });

  it("creates a profile with provider=openai", async () => {
    const cmd = await getProfileCommand();
    await runCommand(cmd, ["add", "oai", "-p", "openai", "-u", "https://api.openai.com"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["oai"].provider).toBe("openai");
    expect(data.profiles["oai"].url).toBe("https://api.openai.com");
  });

  it("updates an existing profile on second add", async () => {
    const cmd1 = await getProfileCommand();
    await runCommand(cmd1, ["add", "dev", "-m", "claude-opus-4-7"]);
    const cmd2 = await getProfileCommand();
    await runCommand(cmd2, ["add", "dev", "-t", "new-token"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["dev"].token).toBe("new-token");
    expect(data.profiles["dev"].model).toBe("claude-opus-4-7");
  });

  it("logs success message", async () => {
    const cmd = await getProfileCommand();
    const { logs } = await runCommand(cmd, ["add", "x", "-m", "m"]);
    expect(logs.some((l) => l.includes("saved"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// profile list
// ---------------------------------------------------------------------------

describe("profile list", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("prints a message when no profiles exist", async () => {
    const cmd = await getProfileCommand();
    const { logs } = await runCommand(cmd, ["list"]);
    expect(logs.some((l) => l.includes("No profiles"))).toBe(true);
  });

  it("lists a profile after adding it", async () => {
    const addCmd = await getProfileCommand();
    await runCommand(addCmd, ["add", "prod", "-m", "claude-opus-4-7", "-t", "tok"]);
    const listCmd = await getProfileCommand();
    const { logs } = await runCommand(listCmd, ["list"]);
    expect(logs.some((l) => l.includes("prod"))).toBe(true);
  });

  it("marks the default profile with an asterisk", async () => {
    // Add two profiles
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "alpha", "-m", "claude-opus-4-7"]);
    const c2 = await getProfileCommand();
    await runCommand(c2, ["add", "beta", "-m", "claude-sonnet-4-6"]);
    // Set default
    const c3 = await getProfileCommand();
    await runCommand(c3, ["default", "alpha"]);
    const c4 = await getProfileCommand();
    const { logs } = await runCommand(c4, ["list"]);
    const alphaLine = logs.find((l) => l.includes("alpha"));
    expect(alphaLine).toBeDefined();
    expect(alphaLine).toMatch(/\*/);
  });
});

// ---------------------------------------------------------------------------
// profile view
// ---------------------------------------------------------------------------

describe("profile view", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("shows full token without masking", async () => {
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "dev", "-t", "sk-very-long-secret-token-here"]);
    const c2 = await getProfileCommand();
    const { logs } = await runCommand(c2, ["view", "dev"]);
    expect(logs.some((l) => l.includes("sk-very-long-secret-token-here"))).toBe(true);
  });

  it("outputs JSON when --json flag is given", async () => {
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "dev", "-m", "claude-opus-4-7"]);
    const c2 = await getProfileCommand();
    const { logs } = await runCommand(c2, ["view", "dev", "--json"]);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.name).toBe("dev");
    expect(parsed.model).toBe("claude-opus-4-7");
  });

  it("exits with code 1 for unknown profile", async () => {
    const cmd = await getProfileCommand();
    const { exitCode } = await runCommand(cmd, ["view", "nonexistent"]);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// profile remove
// ---------------------------------------------------------------------------

describe("profile remove", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("removes an existing profile", async () => {
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "tmp", "-m", "m"]);
    const c2 = await getProfileCommand();
    await runCommand(c2, ["remove", "tmp"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["tmp"]).toBeUndefined();
  });

  it("exits with code 1 when profile does not exist", async () => {
    const cmd = await getProfileCommand();
    const { exitCode } = await runCommand(cmd, ["remove", "ghost"]);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// profile default
// ---------------------------------------------------------------------------

describe("profile default", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("sets the default field", async () => {
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "work", "-m", "m"]);
    const c2 = await getProfileCommand();
    await runCommand(c2, ["default", "work"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.default).toBe("work");
  });

  it("exits with code 1 for unknown profile", async () => {
    const cmd = await getProfileCommand();
    const { exitCode } = await runCommand(cmd, ["default", "nope"]);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// profile update
// ---------------------------------------------------------------------------

describe("profile update", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("exits with code 1 when profile does not exist", async () => {
    const cmd = await getProfileCommand();
    const { exitCode } = await runCommand(cmd, ["update", "ghost", "-t", "tok"]);
    expect(exitCode).toBe(1);
  });

  it("adds a new model via single -m flag", async () => {
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "dev", "-m", "claude-opus-4-7"]);
    const c2 = await getProfileCommand();
    await runCommand(c2, ["update", "dev", "-m", "claude-haiku-4-5"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["dev"].models).toContain("claude-haiku-4-5");
  });

  it("moves an existing model to position 1", async () => {
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "dev", "-m", "claude-opus-4-7", "-m", "claude-sonnet-4-6"]);
    const c2 = await getProfileCommand();
    await runCommand(c2, ["update", "dev", "-m", "claude-sonnet-4-6"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["dev"].models[0]).toBe("claude-sonnet-4-6");
  });

  it("replaces all models when multiple -m flags given", async () => {
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "dev", "-m", "old-model"]);
    const c2 = await getProfileCommand();
    await runCommand(c2, ["update", "dev", "-m", "new-a", "-m", "new-b"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["dev"].models).toEqual(["new-a", "new-b"]);
  });

  it("removes a model via --delete-model", async () => {
    const c1 = await getProfileCommand();
    await runCommand(c1, ["add", "dev", "-m", "keep", "-m", "remove-me"]);
    const c2 = await getProfileCommand();
    await runCommand(c2, ["update", "dev", "--delete-model", "remove-me"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_PROFILES_FILE!, "utf-8"));
    expect(data.profiles["dev"].models).toEqual(["keep"]);
  });
});

// ---------------------------------------------------------------------------
// profile list
