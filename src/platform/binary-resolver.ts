import { spawnSync } from "node:child_process";
import type { IBinaryResolver, IDesktopApp } from "./interfaces.js";
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

export class SystemBinaryResolver implements IBinaryResolver {
  constructor(private app: IDesktopApp) {}

  resolve(): string {
    logger.debug("binary-resolver: trying global 'claude' command");
    try {
      const result = spawnSync("claude", ["--version"], {
        shell: process.platform === "win32",
        encoding: "utf-8",
      });
      if (result.status === 0) {
        logger.debug("binary-resolver: found global 'claude'");
        return "claude";
      }
    } catch {
      // fall through
    }

    logger.debug("binary-resolver: trying desktop app binary");
    const desktopBinary = this.app.findBinary();
    if (desktopBinary) {
      logger.debug(`binary-resolver: found desktop binary at ${desktopBinary}`);
      return desktopBinary;
    }

    throw new Error("Could not find Claude Code CLI. Install it globally or install the Claude Code desktop app.");
  }
}
