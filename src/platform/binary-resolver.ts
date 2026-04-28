import { spawnSync } from "node:child_process";
import type { IBinaryResolver, IDesktopApp } from "./interfaces.js";
import * as logger from "../logger.js";

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
