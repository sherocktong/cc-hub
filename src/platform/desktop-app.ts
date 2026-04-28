import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { IDesktopApp } from "./interfaces.js";

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
    return this.isInstalled() ? path.join(this.supportDir, "configLibrary") : undefined;
  }

  findBinary(): string | undefined {
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
    return path.join(claudeCodeDir, versions[0], "claude.app", "Contents", "MacOS", "claude");
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

  getSessionsDir(): string | undefined {
    const dir = this._findSupportDir();
    return dir ? path.join(dir, "local-agent-mode-sessions") : undefined;
  }

  getConfigLibrary(): string | undefined {
    const dir = this._findSupportDir();
    return dir ? path.join(dir, "configLibrary") : undefined;
  }

  findBinary(): string | undefined {
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
  findBinary(): undefined { return undefined; }
}
