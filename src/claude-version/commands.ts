import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { safeAction } from "../logger.js";
import { fetchChangelogVersions } from "./fetcher.js";
import { getPinnedVersion, setPinnedVersion } from "./utils.js";
import { getClaudeVersion } from "../platform/index.js";
import { MacOSDesktopApp } from "../platform/desktop-app.js";

export function claudeVersionCommand(): Command {
  const cmd = new Command("claude-version")
    .description("Manage Claude Code CLI versions");

  cmd
    .command("list")
    .description("List available Claude Code versions")
    .action(safeAction(async () => {
      const [remoteVersions, installedVersion, pinnedVersion] = await Promise.all([
        fetchChangelogVersions().catch(() => [] as Array<{ version: string; date: string }>),
        Promise.resolve(getClaudeVersion()).catch(() => "unknown"),
        Promise.resolve(getPinnedVersion()),
      ]);

      if (remoteVersions.length === 0) {
        console.log("Could not fetch remote versions. Showing installed version only.");
        console.log(`Installed: ${installedVersion}`);
        if (pinnedVersion) {
          console.log(`Pinned:    ${pinnedVersion}`);
        }
        return;
      }

      console.log("Available Claude Code versions:");
      console.log("");
      const maxVersionLen = Math.max(...remoteVersions.map(v => v.version.length), 10);
      const maxDateLen = Math.max(...remoteVersions.map(v => v.date.length), 4);

      console.log(`${"Version".padEnd(maxVersionLen)}  ${"Date".padEnd(maxDateLen)}  Status`);
      console.log("-".repeat(maxVersionLen + maxDateLen + 10));

      for (const { version, date } of remoteVersions.slice(0, 20)) {
        const markers: string[] = [];
        if (version === installedVersion) markers.push("installed");
        if (version === pinnedVersion) markers.push("pinned");
        const status = markers.length > 0 ? `(${markers.join(", ")})` : "";
        console.log(`${version.padEnd(maxVersionLen)}  ${(date || "—").padEnd(maxDateLen)}  ${status}`);
      }

      if (remoteVersions.length > 20) {
        console.log(`... and ${remoteVersions.length - 20} more versions`);
      }

      console.log("");
      console.log(`Installed: ${installedVersion}`);
      if (pinnedVersion) {
        console.log(`Pinned:    ${pinnedVersion}`);
      } else {
        console.log("No version pinned (using latest)");
      }
    }));

  cmd
    .command("unpin")
    .description("Remove the Claude Code version pin")
    .action(safeAction(() => {
      setPinnedVersion(undefined);
      console.log("Version pin cleared. cc-hub will use the latest available Claude Code version.");
    }));

  cmd
    .command("pin [version]")
    .description("Pin Claude Code to a specific version")
    .option("--clear", "Remove the version pin")
    .action(safeAction(async (version: string | undefined, opts: { clear?: boolean }) => {
      if (opts.clear || !version) {
        setPinnedVersion(undefined);
        console.log("Version pin cleared. cc-hub will use the latest available Claude Code version.");
        return;
      }

      // Validate semver-ish format
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        console.error(`Invalid version format: ${version}. Expected format: x.y.z`);
        process.exit(1);
      }

      // Check if the version is available locally (macOS desktop app)
      let localAvailable = false;
      if (process.platform === "darwin") {
        const desktopApp = new MacOSDesktopApp();
        const supportDir = desktopApp.getSupportDir();
        if (supportDir) {
          const claudeCodeDir = path.join(supportDir, "claude-code");
          if (fs.existsSync(claudeCodeDir)) {
            const versions = fs.readdirSync(claudeCodeDir).filter((d) =>
              fs.existsSync(path.join(claudeCodeDir, d, "claude.app", "Contents", "MacOS", "claude"))
            );
            localAvailable = versions.includes(version);
          }
        }
      }

      setPinnedVersion(version);
      console.log(`Pinned Claude Code version: ${version}`);

      if (process.platform === "darwin" && !localAvailable) {
        console.warn(`Warning: version ${version} is not installed in the desktop app. The pin will take effect once that version is available, or you can install it via:`);
        console.warn(`  npm install -g @anthropic-ai/claude-code@${version}`);
      } else if (process.platform !== "darwin") {
        console.log(`Note: on ${process.platform}, ensure the global install matches the pinned version:`);
        console.log(`  npm install -g @anthropic-ai/claude-code@${version}`);
      }
    }));

  return cmd;
}
