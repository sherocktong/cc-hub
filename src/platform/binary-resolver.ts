import { spawnSync } from "node:child_process";
import type { IBinaryResolver, IDesktopApp } from "./interfaces.js";
import { SETTINGS_FILE, ensureSettingsFile, readJson } from "../config.js";
import type { SettingsData } from "../types.js";
import * as logger from "../logger.js";

let cachedVersion: string | undefined;

export function getClaudeVersion(): string {
  if (cachedVersion) return cachedVersion;

  logger.debug("binary-resolver: detecting Claude version");
  try {
    const result = spawnSync("claude", ["--version"], {
      shell: process.platform === "win32",
      encoding: "utf-8",
    });
    if (result.status === 0 && result.stdout) {
      const match = result.stdout.trim().match(/^(\d+\.\d+\.\d+)/);
      if (match) {
        cachedVersion = match[1];
        logger.debug(`binary-resolver: detected Claude version ${cachedVersion}`);
        return cachedVersion;
      }
    }
  } catch {
    // fall through
  }

  cachedVersion = "0.0.0";
  logger.debug("binary-resolver: could not detect Claude version, using default");
  return cachedVersion;
}

function getPinnedVersion(): string | undefined {
  try {
    ensureSettingsFile();
    const settings = readJson<SettingsData>(SETTINGS_FILE);
    if (settings.minimumVersion && settings.requiredMaximumVersion && settings.minimumVersion === settings.requiredMaximumVersion) {
      return settings.minimumVersion;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export class SystemBinaryResolver implements IBinaryResolver {
  constructor(private app: IDesktopApp) {}

  resolve(pinnedVersion?: string): string {
    const pin = pinnedVersion ?? getPinnedVersion();

    logger.debug("binary-resolver: trying global 'claude' command");
    try {
      const result = spawnSync("claude", ["--version"], {
        shell: process.platform === "win32",
        encoding: "utf-8",
      });
      if (result.status === 0) {
        logger.debug("binary-resolver: found global 'claude'");
        if (pin) {
          const currentVersion = getClaudeVersion();
          if (currentVersion !== pin) {
            logger.warn(`binary-resolver: global claude version ${currentVersion} does not match pinned version ${pin}`);
            console.warn(`Warning: installed Claude version (${currentVersion}) does not match pinned version (${pin}).`);
            console.warn(`To install the pinned version, run: npm install -g @anthropic-ai/claude-code@${pin}`);
          } else {
            logger.debug(`binary-resolver: global claude version matches pinned ${pin}`);
          }
        }
        return "claude";
      }
    } catch {
      // fall through
    }

    logger.debug("binary-resolver: trying desktop app binary");
    const desktopBinary = this.app.findBinary(pin);
    if (desktopBinary) {
      logger.debug(`binary-resolver: found desktop binary at ${desktopBinary}`);
      return desktopBinary;
    }

    throw new Error("Could not find Claude Code CLI. Install it globally or install the Claude Code desktop app.");
  }
}
