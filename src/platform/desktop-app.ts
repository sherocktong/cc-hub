import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { IDesktopApp } from "./interfaces.js";
import * as logger from "../logger.js";

function sortSemverDesc(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10));
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const an = av[i] || 0;
    const bn = bv[i] || 0;
    if (an !== bn) return bn - an;
  }
  return 0;
}

export class MacOSDesktopApp implements IDesktopApp {
  private readonly supportDir = path.join(os.homedir(), "Library/Application Support/Claude-3p");

  isInstalled(): boolean {
    return fs.existsSync(this.supportDir);
  }

  getSupportDir(): string | undefined {
    return this.isInstalled() ? this.supportDir : undefined;
  }

  getSessionsDir(): string | undefined {
    return this.isInstalled() ? path.join(this.supportDir, "local-agent-mode-sessions") : undefined;
  }

  getConfigLibrary(): string | undefined {
    if (!this.isInstalled()) return undefined;
    const configLib = path.join(this.supportDir, "configLibrary");
    if (fs.existsSync(path.join(configLib, "_meta.json"))) return configLib;
    if (fs.existsSync(configLib)) return configLib;
    return configLib;
  }

  findBinary(pinnedVersion?: string): string | undefined {
    logger.debug(`desktop-app: searching for binary in ${this.supportDir}`);
    const claudeCodeDir = path.join(this.supportDir, "claude-code");
    if (!fs.existsSync(claudeCodeDir)) return undefined;

    let versions: string[];
    try {
      versions = fs.readdirSync(claudeCodeDir).filter((d) =>
        fs.existsSync(path.join(claudeCodeDir, d, "claude.app", "Contents", "MacOS", "claude"))
      );
    } catch {
      return undefined;
    }

    if (versions.length === 0) return undefined;

    versions.sort(sortSemverDesc);

    let targetVersion = versions[0];
    if (pinnedVersion) {
      const match = versions.find((v) => v === pinnedVersion);
      if (match) {
        targetVersion = match;
        logger.debug(`desktop-app: using pinned version ${targetVersion}`);
      } else {
        logger.warn(`desktop-app: pinned version ${pinnedVersion} not found locally; falling back to latest ${targetVersion}`);
      }
    }

    const binary = path.join(claudeCodeDir, targetVersion, "claude.app", "Contents", "MacOS", "claude");
    logger.debug(`desktop-app: found macOS binary ${binary}`);
    return binary;
  }
}

export class WindowsDesktopApp implements IDesktopApp {
  private _buildCandidates(): string[] {
    const candidates = [
      path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude-3p"),
      path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude"),
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Claude-3p"),
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Claude"),
    ];

    // Dynamically discover MSIX package directories (Windows Store install)
    const packagesDir = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "Packages",
    );
    if (fs.existsSync(packagesDir)) {
      try {
        const entries = fs.readdirSync(packagesDir);
        for (const entry of entries) {
          if (entry.startsWith("Claude_")) {
            candidates.push(path.join(packagesDir, entry, "LocalCache", "Roaming", "Claude-3p"));
            candidates.push(path.join(packagesDir, entry, "LocalCache", "Roaming", "Claude"));
          }
        }
      } catch {
        // ignore permission/read errors
      }
    }

    return candidates;
  }

  private _findSupportDir(): string | undefined {
    for (const dir of this._buildCandidates()) {
      if (fs.existsSync(dir)) return dir;
    }
    return undefined;
  }

  isInstalled(): boolean {
    return this._findSupportDir() !== undefined;
  }

  getSupportDir(): string | undefined {
    return this._findSupportDir();
  }

  getConfigLibrary(): string | undefined {
    const candidates = this._buildCandidates();

    for (const dir of candidates) {
      const configLib = path.join(dir, "configLibrary");
      if (fs.existsSync(path.join(configLib, "_meta.json"))) {
        return configLib;
      }
    }

    for (const dir of candidates) {
      const configLib = path.join(dir, "configLibrary");
      if (fs.existsSync(configLib)) {
        return configLib;
      }
    }

    const dir = this._findSupportDir();
    return dir ? path.join(dir, "configLibrary") : undefined;
  }

  getSessionsDir(): string | undefined {
    const candidates = this._buildCandidates();

    for (const dir of candidates) {
      const sessionsDir = path.join(dir, "local-agent-mode-sessions");
      if (fs.existsSync(sessionsDir)) {
        return sessionsDir;
      }
    }

    const dir = this._findSupportDir();
    return dir ? path.join(dir, "local-agent-mode-sessions") : undefined;
  }

  findBinary(_pinnedVersion?: string): string | undefined {
    const win32Binary = path.join(process.env.LOCALAPPDATA || "", "Programs", "Claude", "Claude.exe");
    if (fs.existsSync(win32Binary)) return win32Binary;
    return undefined;
  }
}

export class NoOpDesktopApp implements IDesktopApp {
  isInstalled(): boolean { return false; }
  getSupportDir(): undefined { return undefined; }
  getSessionsDir(): undefined { return undefined; }
  getConfigLibrary(): undefined { return undefined; }
  findBinary(_pinnedVersion?: string): undefined { return undefined; }
}
