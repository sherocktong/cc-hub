import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";

let tmpDir: string;

function setup() {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hub-hook-test-"));
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

async function getHooksCommand() {
  const mod = await import("../../src/hooks.js");
  return mod.hooksCommand();
}

// ---------------------------------------------------------------------------
// hook list
// ---------------------------------------------------------------------------

describe("hook list", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("prints no hooks when settings file is empty", async () => {
    const cmd = await getHooksCommand();
    const { logs } = await runCommand(cmd, ["list"]);
    expect(logs.some((l) => l.includes("No hooks"))).toBe(true);
  });

  it("lists hooks after adding one", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "PreToolUse", "-c", "echo before"]);
    const c2 = await getHooksCommand();
    const { logs } = await runCommand(c2, ["list"]);
    expect(logs.some((l) => l.includes("PreToolUse"))).toBe(true);
    expect(logs.some((l) => l.includes("echo before"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hook add
// ---------------------------------------------------------------------------

describe("hook add", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("adds a hook to settings.json", async () => {
    const cmd = await getHooksCommand();
    await runCommand(cmd, ["add", "-e", "PreToolUse", "-c", "echo pre"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data.hooks?.PreToolUse).toBeDefined();
    const groups = data.hooks.PreToolUse;
    expect(groups[0].hooks[0].command).toBe("echo pre");
  });

  it("adds a hook with matcher", async () => {
    const cmd = await getHooksCommand();
    await runCommand(cmd, ["add", "-e", "PostToolUse", "-m", "Bash", "-c", "echo bash-post"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    const groups = data.hooks.PostToolUse;
    const matched = groups.find((g: any) => g.matcher === "Bash");
    expect(matched).toBeDefined();
    expect(matched.hooks[0].command).toBe("echo bash-post");
  });

  it("adds an async hook", async () => {
    const cmd = await getHooksCommand();
    await runCommand(cmd, ["add", "-e", "Notification", "-c", "notify", "--async"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data.hooks.Notification[0].hooks[0].async).toBe(true);
  });

  it("adds multiple hooks under the same event", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "Stop", "-c", "cmd1"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["add", "-e", "Stop", "-c", "cmd2"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    const cmds = data.hooks.Stop[0].hooks.map((h: any) => h.command);
    expect(cmds).toContain("cmd1");
    expect(cmds).toContain("cmd2");
  });

  it("increments _cc_hub_seq for each added hook", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "PreToolUse", "-c", "a"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["add", "-e", "PreToolUse", "-c", "b"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data._cc_hub_seq).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// hook remove
// ---------------------------------------------------------------------------

describe("hook remove", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("removes an active hook by index", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "PreToolUse", "-c", "remove-me"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["remove", "-i", "0"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data.hooks?.PreToolUse).toBeUndefined();
  });

  it("removes a disabled hook by index", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "Stop", "-c", "bye"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["disable", "-i", "0"]);
    const c3 = await getHooksCommand();
    await runCommand(c3, ["remove", "-i", "0"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data._cc_hub_disabled).toBeUndefined();
  });

  it("exits with code 1 for out-of-range index", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "Stop", "-c", "x"]);
    const c2 = await getHooksCommand();
    const { exitCode } = await runCommand(c2, ["remove", "-i", "99"]);
    expect(exitCode).toBe(1);
  });

  it("cleans up empty event key after last hook removed", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "UserPromptSubmit", "-c", "only"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["remove", "-i", "0"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data.hooks?.UserPromptSubmit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hook disable / enable
// ---------------------------------------------------------------------------

describe("hook disable", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("moves hook from active to _cc_hub_disabled", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "PreToolUse", "-c", "echo hi"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["disable", "-i", "0"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data.hooks?.PreToolUse).toBeUndefined();
    expect(data._cc_hub_disabled).toHaveLength(1);
    expect(data._cc_hub_disabled[0].command).toBe("echo hi");
    expect(data._cc_hub_disabled[0].event).toBe("PreToolUse");
  });

  it("exits with code 1 when trying to disable an already-disabled hook", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "Stop", "-c", "x"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["disable", "-i", "0"]);
    const c3 = await getHooksCommand();
    const { exitCode } = await runCommand(c3, ["disable", "-i", "0"]);
    expect(exitCode).toBe(1);
  });

  it("exits with code 1 for out-of-range index", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "Stop", "-c", "y"]);
    const c2 = await getHooksCommand();
    const { exitCode } = await runCommand(c2, ["disable", "-i", "5"]);
    expect(exitCode).toBe(1);
  });
});

describe("hook enable", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("restores a disabled hook back to active hooks", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "PreToolUse", "-c", "restored"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["disable", "-i", "0"]);
    const c3 = await getHooksCommand();
    await runCommand(c3, ["enable", "-i", "0"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data._cc_hub_disabled).toBeUndefined();
    expect(data.hooks?.PreToolUse[0].hooks[0].command).toBe("restored");
  });

  it("exits with code 1 when trying to enable an already-active hook", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "Stop", "-c", "active"]);
    const c2 = await getHooksCommand();
    const { exitCode } = await runCommand(c2, ["enable", "-i", "0"]);
    expect(exitCode).toBe(1);
  });

  it("enables only the targeted hook when multiple disabled hooks lack _seq", async () => {
    // Hooks added externally (not via cc-hub add) have no _seq, so they all get seq=0
    // in buildFlat. The bug caused all seq=0 hooks to be enabled together.
    fs.writeFileSync(
      process.env.CLAUDE_SETTINGS_FILE!,
      JSON.stringify({
        _cc_hub_disabled: [
          { event: "Stop", type: "command", command: "echo hook-a" },
          { event: "Stop", type: "command", command: "echo hook-b" },
        ],
      })
    );
    const cmd = await getHooksCommand();
    // rows[0]=hook-a, rows[1]=hook-b (stable sort, both seq=0)
    await runCommand(cmd, ["enable", "-i", "1"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    expect(data._cc_hub_disabled).toHaveLength(1);
    expect(data._cc_hub_disabled[0].command).toBe("echo hook-a");
    const enabled = data.hooks?.Stop?.[0]?.hooks;
    expect(enabled).toHaveLength(1);
    expect(enabled[0].command).toBe("echo hook-b");
  });

  it("logs the correct row index when enabling a hook without _seq", async () => {
    fs.writeFileSync(
      process.env.CLAUDE_SETTINGS_FILE!,
      JSON.stringify({
        _cc_hub_disabled: [
          { event: "Stop", type: "command", command: "echo hook-a" },
          { event: "Stop", type: "command", command: "echo hook-b" },
        ],
      })
    );
    const cmd = await getHooksCommand();
    const { logs } = await runCommand(cmd, ["enable", "-i", "1"]);
    expect(logs.some((l) => l.includes("Hook 1"))).toBe(true);
    expect(logs.some((l) => l.includes("Hook -1"))).toBe(false);
  });

  it("preserves matcher when re-enabling a hook", async () => {
    const c1 = await getHooksCommand();
    await runCommand(c1, ["add", "-e", "PostToolUse", "-m", "Bash", "-c", "echo matched"]);
    const c2 = await getHooksCommand();
    await runCommand(c2, ["disable", "-i", "0"]);
    const c3 = await getHooksCommand();
    await runCommand(c3, ["enable", "-i", "0"]);
    const data = JSON.parse(fs.readFileSync(process.env.CLAUDE_SETTINGS_FILE!, "utf-8"));
    const groups = data.hooks?.PostToolUse;
    expect(groups).toBeDefined();
    const matched = groups.find((g: any) => g.matcher === "Bash");
    expect(matched).toBeDefined();
  });
});
