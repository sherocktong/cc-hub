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

export function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function ensureProfilesFile(): void {
  ensureFile(PROFILES_FILE, '{"profiles":{}}\n');
}

export function ensureSettingsFile(): void {
  ensureFile(SETTINGS_FILE, "{}\n");
}
