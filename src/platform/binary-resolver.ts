import { spawnSync } from "node:child_process";
import type { IBinaryResolver, IDesktopApp } from "./interfaces.js";

export class SystemBinaryResolver implements IBinaryResolver {
  constructor(private app: IDesktopApp) {}

  resolve(): string {
    try {
      const result = spawnSync("claude", ["--version"], {
        shell: process.platform === "win32",
        encoding: "utf-8",
      });
      if (result.status === 0) {
        return "claude";
      }
    } catch {
      // fall through
    }

    const desktopBinary = this.app.findBinary();
    if (desktopBinary) return desktopBinary;

    console.error("Error: Could not find Claude Code CLI.");
    console.error("Install it globally or install the Claude Code desktop app.");
    process.exit(1);
  }
}
