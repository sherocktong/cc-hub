import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createDesktopApp } from "./platform/index.js";

export const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), ".claude");
export const PROFILES_FILE = process.env.CLAUDE_PROFILES_FILE || path.join(CLAUDE_DIR, "profiles.json");
export const SETTINGS_FILE = process.env.CLAUDE_SETTINGS_FILE || path.join(CLAUDE_DIR, "settings.json");
export const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");
export const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
export const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");

// Desktop paths — delegated to platform layer for backward compatibility
const desktopApp = createDesktopApp();

export const DESKTOP_CONFIG_LIBRARY = desktopApp.getConfigLibrary() || "";
export const DESKTOP_META_FILE = DESKTOP_CONFIG_LIBRARY
  ? path.join(DESKTOP_CONFIG_LIBRARY, "_meta.json")
  : "";
export const DESKTOP_SESSIONS_DIR = desktopApp.getSessionsDir() || "";

export function isDesktopAppInstalled(): boolean {
  return desktopApp.isInstalled();
}

export function isDesktopProfileSyncSupported(): boolean {
  return desktopApp.isInstalled();
}

export function findDesktopClaudeBinary(): string | undefined {
  return desktopApp.findBinary();
}

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

/**
 * Validate a JSON file and auto-correct if invalid.
 * If valid, backs it up to ~/.claude/ for restore on fix failure.
 * If invalid and fixable, writes the corrected text back.
 * If invalid and unfixable, restores from backup (or writes fallback).
 * No-op if the file doesn't exist.
 */
export function fixJsonFile(filePath: string, fallback: Record<string, unknown> = {}): void {
  if (!fs.existsSync(filePath)) return;

  const backupPath = path.join(CLAUDE_DIR, path.basename(filePath) + ".backup");
  const raw = fs.readFileSync(filePath, "utf-8");

  // Try normal parse — if valid, back it up
  try {
    JSON.parse(raw);
    fs.copyFileSync(filePath, backupPath);
    return;
  } catch {
    // fall through to recovery
  }

  let text = raw.trim();

  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1).trim();
  }

  // Remove trailing comma at end of file
  text = text.replace(/,\s*$/, "");

  // Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, "$1");

  // Strip content after the last closing brace/bracket
  const lastBrace = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (lastBrace !== -1 && lastBrace < text.length - 1) {
    text = text.slice(0, lastBrace + 1);
  }

  // Auto-close unbalanced braces/brackets
  let openCurly = 0, openSquare = 0;
  for (const ch of text) {
    if (ch === "{") openCurly++;
    else if (ch === "}") openCurly--;
    else if (ch === "[") openSquare++;
    else if (ch === "]") openSquare--;
  }
  if (openSquare > 0) text += "]".repeat(openSquare);
  if (openCurly > 0) text += "}".repeat(openCurly);

  // Try parse after fixes
  try {
    JSON.parse(text);
    fs.writeFileSync(filePath, text + "\n", "utf-8");
    console.error(`Fixed invalid JSON in ${path.basename(filePath)}.`);
  } catch {
    // Unrecoverable — restore backup or write fallback
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, filePath);
      console.error(`Restored ${path.basename(filePath)} from backup.`);
    } else {
      writeJson(filePath, fallback);
      console.error(`Could not fix ${path.basename(filePath)}, no backup found, reset to default.`);
    }
  }
}
