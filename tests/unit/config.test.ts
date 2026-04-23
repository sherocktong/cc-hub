import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fixJsonFile, readJson, writeJson, ensureFile, PROFILES_FILE, SETTINGS_FILE } from "../../src/config.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// CLAUDE_DIR is set at module load time — we derive the backup root from PROFILES_FILE
const CLAUDE_DIR = path.dirname(PROFILES_FILE);

let tmpDir: string;

function setupTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hub-test-"));
}

function teardownTmpDir() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe("fixJsonFile", () => {
  beforeEach(setupTmpDir);
  afterEach(teardownTmpDir);

  it("is a no-op for a non-existent file", () => {
    const nonExistent = path.join(tmpDir, "missing.json");
    expect(() => fixJsonFile(nonExistent)).not.toThrow();
    expect(fs.existsSync(nonExistent)).toBe(false);
  });

  it("backs up a valid JSON file to CLAUDE_DIR and leaves source unchanged", () => {
    const file = path.join(tmpDir, "valid.json");
    const content = JSON.stringify({ foo: "bar" });
    fs.writeFileSync(file, content);
    fixJsonFile(file);
    expect(fs.readFileSync(file, "utf-8")).toBe(content);
    // Backup is in CLAUDE_DIR (not next to the file)
    const backup = path.join(CLAUDE_DIR, "valid.json.backup");
    expect(fs.existsSync(backup)).toBe(true);
    // Cleanup backup
    fs.rmSync(backup, { force: true });
  });

  it("repairs trailing comma before closing brace", () => {
    const file = path.join(tmpDir, "trailing.json");
    fs.writeFileSync(file, '{"key":"value",}');
    fixJsonFile(file);
    const result = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(result).toEqual({ key: "value" });
  });

  it("repairs trailing comma at end of file", () => {
    const file = path.join(tmpDir, "trailing2.json");
    fs.writeFileSync(file, '{"a":1},');
    fixJsonFile(file);
    const result = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(result).toEqual({ a: 1 });
  });

  it("auto-closes unbalanced curly braces", () => {
    const file = path.join(tmpDir, "unclosed.json");
    fs.writeFileSync(file, '{"a":{"b":1}');
    fixJsonFile(file);
    const result = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(result).toEqual({ a: { b: 1 } });
  });

  it("auto-closes unbalanced square brackets", () => {
    const file = path.join(tmpDir, "unclosed-arr.json");
    fs.writeFileSync(file, '[1,2,3');
    fixJsonFile(file);
    const result = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(result).toEqual([1, 2, 3]);
  });

  it("strips content after the last closing brace", () => {
    const file = path.join(tmpDir, "garbage.json");
    fs.writeFileSync(file, '{"x":1}garbage');
    fixJsonFile(file);
    const result = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(result).toEqual({ x: 1 });
  });

  it("strips BOM from start of file", () => {
    const file = path.join(tmpDir, "bom.json");
    fs.writeFileSync(file, Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('{"a":1,}')]));
    fixJsonFile(file);
    const result = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(result).toEqual({ a: 1 });
  });

  it("restores from backup when JSON is unrecoverable", () => {
    const file = path.join(tmpDir, "unrecoverable.json");
    // Backup must be in CLAUDE_DIR (where fixJsonFile looks)
    const backup = path.join(CLAUDE_DIR, "unrecoverable.json.backup");
    const validContent = '{"safe":true}\n';
    fs.writeFileSync(backup, validContent);
    fs.writeFileSync(file, "this is not json at all {{{{");
    try {
      fixJsonFile(file);
      expect(fs.readFileSync(file, "utf-8")).toBe(validContent);
    } finally {
      fs.rmSync(backup, { force: true });
    }
  });

  it("writes fallback when unrecoverable and no backup exists", () => {
    const file = path.join(tmpDir, "no-backup.json");
    // Ensure no stale backup exists
    const backup = path.join(CLAUDE_DIR, "no-backup.json.backup");
    fs.rmSync(backup, { force: true });
    fs.writeFileSync(file, "not json {{{{");
    fixJsonFile(file, { fallback: true });
    const result = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(result).toEqual({ fallback: true });
  });
});

describe("readJson / writeJson", () => {
  beforeEach(setupTmpDir);
  afterEach(teardownTmpDir);

  it("round-trips an object through write then read", () => {
    const file = path.join(tmpDir, "roundtrip.json");
    const data = { profiles: { dev: { model: "claude-opus-4-7" } }, default: "dev" };
    writeJson(file, data);
    expect(readJson(file)).toEqual(data);
  });

  it("writeJson produces pretty-printed JSON with trailing newline", () => {
    const file = path.join(tmpDir, "pretty.json");
    writeJson(file, { a: 1 });
    const raw = fs.readFileSync(file, "utf-8");
    expect(raw).toMatch(/\n$/);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe("ensureFile", () => {
  beforeEach(setupTmpDir);
  afterEach(teardownTmpDir);

  it("creates the file with default content when it does not exist", () => {
    const file = path.join(tmpDir, "new", "file.json");
    ensureFile(file, '{"created":true}');
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ created: true });
  });

  it("leaves an existing file unchanged", () => {
    const file = path.join(tmpDir, "existing.json");
    fs.writeFileSync(file, '{"original":1}');
    ensureFile(file, '{"default":2}');
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ original: 1 });
  });
});
