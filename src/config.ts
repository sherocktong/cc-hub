import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), ".claude");
export const PROFILES_FILE = process.env.CLAUDE_PROFILES_FILE || path.join(CLAUDE_DIR, "profiles.json");
export const SETTINGS_FILE = process.env.CLAUDE_SETTINGS_FILE || path.join(CLAUDE_DIR, "settings.json");
export const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
export const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");

export function ensureFile(filePath: string, defaultContent: string): void {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, defaultContent, "utf-8");
  }
}

export function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

/**
 * Read JSON with automatic recovery from common formatting errors.
 * Fixes: trailing commas, BOM, trailing content, and missing braces.
 * If recovery fails, backs up the corrupt file and returns `fallback`.
 */
export function readJsonSafe<T = unknown>(filePath: string, fallback: T): T {
  const raw = fs.readFileSync(filePath, "utf-8");

  // Try normal parse first
  try {
    return JSON.parse(raw) as T;
  } catch {
    // fall through to recovery
  }

  let text = raw;

  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, "$1");

  // Strip content after the last closing brace/bracket (e.g. garbage at end of file)
  const lastBrace = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (lastBrace !== -1 && lastBrace < text.length - 1) {
    text = text.slice(0, lastBrace + 1);
  }

  // Try parse after fixes
  try {
    const data = JSON.parse(text) as T;
    // Write back the corrected version
    writeJson(filePath, data);
    console.error(`Fixed invalid JSON in ${path.basename(filePath)} (auto-corrected formatting errors).`);
    return data;
  } catch {
    // Unrecoverable — back up and use fallback
    const backup = filePath + ".bak";
    fs.renameSync(filePath, backup);
    writeJson(filePath, fallback);
    console.error(`Could not fix ${path.basename(filePath)} — corrupt file backed up to ${path.basename(backup)}, reset to default.`);
    return fallback;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function ensureProfilesFile(): void {
  ensureFile(PROFILES_FILE, '{"profiles":{}}\n');
}

export function ensureSettingsFile(): void {
  ensureFile(SETTINGS_FILE, "{}\n");
}
