import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { PROJECTS_DIR, SESSIONS_DIR } from "./config.js";

// Encode an absolute path to the project directory name format.
// Encoding: '.' → '-', '/' → '-', so '--' in encoded = '/.'
export function encodePath(p: string): string {
  return p.replace(/\./g, "DOTMARK").replace(/\//g, "-").replace(/DOTMARK/g, "-");
}

// Decode an encoded project directory name back to an absolute path.
export function decodePath(encoded: string): string {
  return encoded.replace(/--/g, "/.").replace(/-/g, "/");
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function findProjectDir(query: string): string | null {
  const encoded = encodePath(query);
  if (fs.existsSync(path.join(PROJECTS_DIR, encoded))) return encoded;

  try {
    const dirs = fs.readdirSync(PROJECTS_DIR);
    const match = dirs.find((d) => d.toLowerCase().includes(query.toLowerCase()));
    return match || null;
  } catch {
    return null;
  }
}

// Parse first timestamp and slug from a JSONL session file
function parseSessionMeta(filePath: string): { started: string; slug: string } {
  let started = "?";
  let slug = "";
  let customTitle = "";
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (started === "?") {
          const ts = d.timestamp;
          if (ts) {
            const dt = typeof ts === "number"
              ? new Date(ts)
              : new Date(String(ts).replace("Z", "+00:00"));
            started = formatTimestamp(dt.getTime());
          }
        }
        if (!slug) slug = d.slug || "";
        if (d.type === "custom-title") customTitle = d.customTitle || "";
      } catch { /* skip bad lines */ }
    }
  } catch { /* skip unreadable files */ }
  return { started, slug: customTitle || slug };
}

// Extract text content from a JSONL line
export function extractText(d: Record<string, unknown>): { role: string; text: string } {
  const message = d.message as Record<string, unknown> | undefined;
  let content: unknown;
  let role = "";

  if (message) {
    content = message.content;
    role = (message.role as string) || "";
  } else {
    content = d.content;
    role = (d.type as string) || (d.operation as string) || "";
  }

  if (Array.isArray(content)) {
    for (const p of content) {
      if (typeof p === "object" && p !== null && (p as Record<string, unknown>).type === "text") {
        return { role, text: (p as Record<string, unknown>).text as string };
      }
    }
  } else if (typeof content === "string") {
    return { role, text: content };
  }
  return { role: "", text: "" };
}

export function snippet(text: string, query: string, width = 150): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, width);
  const start = Math.max(0, idx - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return prefix + text.slice(start, end) + suffix;
}

export function sessionCommand(): Command {
  const session = new Command("session")
    .description("Manage Claude Code sessions");

  // --- list ---
  session
    .command("list")
    .description("List all Claude Code project sessions")
    .option("-n, --limit <n>", "Max number of projects to show", "30")
    .option("-s, --short", "Show encoded names only (no decoding)")
    .option("-j, --json", "Output as JSON lines")
    .action((opts: { limit: string; short?: boolean; json?: boolean }) => {
      const limit = parseInt(opts.limit, 10);
      let dirs: string[];
      try {
        dirs = fs.readdirSync(PROJECTS_DIR);
      } catch {
        console.log("No projects directory found.");
        return;
      }

      // Sort by modification time (most recent first)
      dirs.sort((a, b) => {
        const statA = fs.statSync(path.join(PROJECTS_DIR, a));
        const statB = fs.statSync(path.join(PROJECTS_DIR, b));
        return statB.mtimeMs - statA.mtimeMs;
      });

      let count = 0;
      for (const projDir of dirs) {
        if (count >= limit) break;
        const fullPath = path.join(PROJECTS_DIR, projDir);
        let nSessions = 0;
        try {
          nSessions = fs.readdirSync(fullPath).filter((f) => f.endsWith(".jsonl")).length;
        } catch { /* skip */ }

        const stat = fs.statSync(fullPath);
        const decoded = decodePath(projDir);

        if (opts.json) {
          console.log(JSON.stringify({ project: decoded, sessions: nSessions, modified: Math.floor(stat.mtimeMs) }));
        } else if (opts.short) {
          console.log(projDir);
        } else {
          console.log(`${decoded.padEnd(55)}  ${String(nSessions).padStart(3)} session(s)  ${formatTimestamp(stat.mtimeMs)}`);
        }
        count++;
      }
    });

  // --- show ---
  session
    .command("show")
    .description("Show session files for a project")
    .argument("<project>", "Project path or encoded name (partial match ok)")
    .option("-v, --verbose", "Show first user message of each session")
    .action((project: string, opts: { verbose?: boolean }) => {
      const projDir = findProjectDir(project);
      if (!projDir) {
        console.error(`No project matched: ${project}`);
        process.exit(1);
      }

      const fullPath = path.join(PROJECTS_DIR, projDir);
      console.log(`Project: ${decodePath(projDir)}`);
      console.log(`Dir:     ${fullPath}`);
      console.log("");

      const fmt = (sid: string, name: string, started: string, msgs: string) =>
        `${sid.padEnd(36)}  ${name.padEnd(30)}  ${started.padEnd(17)}  ${msgs}`;
      console.log(fmt("Session ID", "Name", "Started", "Messages"));
      console.log(fmt("----------", "----", "-------", "--------"));

      let files: string[];
      try {
        files = fs.readdirSync(fullPath).filter((f) => f.endsWith(".jsonl"));
      } catch {
        return;
      }

      for (const file of files) {
        const filePath = path.join(fullPath, file);
        const sessionId = file.replace(/\.jsonl$/, "");
        let msgCount = 0;
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          msgCount = content ? content.split("\n").filter((l) => l.trim()).length : 0;
        } catch { /* skip */ }

        const { started, slug } = parseSessionMeta(filePath);
        console.log(fmt(sessionId, slug || "-", started, String(msgCount)));

        if (opts.verbose) {
          try {
            const lines = fs.readFileSync(filePath, "utf-8").split("\n");
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const d = JSON.parse(line);
                if (d.type === "user") {
                  const content = d.message?.content;
                  if (Array.isArray(content)) {
                    for (const part of content) {
                      if (typeof part === "object" && part?.type === "text") {
                        console.log(`  > ${part.text.slice(0, 120)}`);
                        break;
                      }
                    }
                  } else if (typeof content === "string") {
                    console.log(`  > ${content.slice(0, 120)}`);
                  }
                  break;
                }
              } catch { /* skip bad lines */ }
            }
          } catch { /* skip */ }
        }
      }
    });

  // --- search ---
  session
    .command("search")
    .description("Search conversation history across all projects")
    .argument("<query>", "Text to search for")
    .option("-p, --project <project>", "Filter to a specific project (partial match)")
    .option("-n, --limit <n>", "Max number of matching files to show", "20")
    .option("-i, --ignore-case", "Case-insensitive search")
    .action((query: string, opts: { project?: string; limit: string; ignoreCase?: boolean }) => {
      let searchRoot = PROJECTS_DIR;
      if (opts.project) {
        const projDir = findProjectDir(opts.project);
        if (!projDir) {
          console.error(`No project matched: ${opts.project}`);
          process.exit(1);
        }
        searchRoot = path.join(PROJECTS_DIR, projDir);
      }

      const limit = parseInt(opts.limit, 10);
      let count = 0;

      function searchDir(dir: string): void {
        if (count >= limit) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (count >= limit) break;
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            searchDir(fullPath);
          } else if (entry.name.endsWith(".jsonl")) {
            try {
              const content = fs.readFileSync(fullPath, "utf-8");
              const lines = content.split("\n");
              let found = false;

              for (let lineno = 0; lineno < lines.length; lineno++) {
                const line = lines[lineno];
                if (!line.trim()) continue;

                const match = opts.ignoreCase
                  ? line.toLowerCase().includes(query.toLowerCase())
                  : line.includes(query);

                if (match) {
                  if (!found) {
                    const relPath = path.relative(PROJECTS_DIR, fullPath);
                    const projEnc = relPath.split("/")[0];
                    const sessionId = path.basename(fullPath, ".jsonl");
                    console.log(`[${decodePath(projEnc)}  →  ${sessionId}]`);
                    found = true;
                    count++;
                  }

                  try {
                    const d = JSON.parse(line);
                    const { role, text } = extractText(d);
                    if (text) {
                      console.log(`  line ${lineno + 1} [${role}]: ${snippet(text, query)}`);
                    } else {
                      console.log(`  line ${lineno + 1}: ${line.slice(0, 140)}`);
                    }
                  } catch {
                    console.log(`  line ${lineno + 1}: ${line.slice(0, 140)}`);
                  }

                  // Show max 5 matches per file
                  const matchCount = lines.slice(0, lineno + 1).filter((l, i) => {
                    if (i > lineno) return false;
                    return opts.ignoreCase
                      ? l.toLowerCase().includes(query.toLowerCase())
                      : l.includes(query);
                  }).length;
                  if (matchCount >= 5) break;
                }
              }
              if (found) console.log("");
            } catch { /* skip unreadable files */ }
          }
        }
      }

      searchDir(searchRoot);
    });

  // --- ps ---
  session
    .command("ps")
    .description("Show active Claude Code processes")
    .action(() => {
      let files: string[];
      try {
        files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
      } catch {
        console.log("(no session files found)");
        return;
      }

      if (files.length === 0) {
        console.log("(no session files found)");
        return;
      }

      const fmt = (pid: string, sid: string, started: string, cwd: string, status: string) =>
        `${pid.padEnd(8)}  ${sid.padEnd(40)}  ${started.padEnd(20)}  ${cwd}${status}`;
      console.log(fmt("PID", "Session ID", "Started", "CWD", ""));
      console.log(fmt("---", "----------", "-------", "---", ""));

      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8"));
          const pid = String(data.pid || "?");
          const sessionId = data.sessionId || "?";
          const cwd = data.cwd || "?";
          const startedMs = data.startedAt || 0;

          let alive = " [dead]";
          try {
            process.kill(Number(pid), 0);
            alive = " [running]";
          } catch { /* dead */ }

          console.log(fmt(pid, sessionId, formatTimestamp(startedMs), cwd, alive));
        } catch { /* skip bad files */ }
      }
    });

  // --- stats ---
  session
    .command("stats")
    .description("Show summary statistics across all Claude Code sessions")
    .action(() => {
      let nProjects = 0;
      let nSessions = 0;
      let totalMsgs = 0;
      let nActive = 0;

      try {
        nProjects = fs.readdirSync(PROJECTS_DIR).length;
      } catch { /* no projects dir */ }

      try {
        const walk = (dir: string): string[] => {
          const results: string[] = [];
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) results.push(...walk(fullPath));
              else if (entry.name.endsWith(".jsonl")) results.push(fullPath);
            }
          } catch { /* skip */ }
          return results;
        };
        const sessionFiles = walk(PROJECTS_DIR);
        nSessions = sessionFiles.length;
        for (const f of sessionFiles) {
          try {
            const content = fs.readFileSync(f, "utf-8");
            totalMsgs += content ? content.split("\n").filter((l) => l.trim()).length : 0;
          } catch { /* skip */ }
        }
      } catch { /* no projects dir */ }

      try {
        nActive = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json")).length;
      } catch { /* no sessions dir */ }

      console.log(`Projects:        ${nProjects}`);
      console.log(`Sessions:        ${nSessions}`);
      console.log(`Total messages:  ${totalMsgs}`);
      console.log(`Active procs:    ${nActive}  (in ${SESSIONS_DIR})`);
      console.log("");

      try {
        const totalSize = execSync(`du -sh "${path.join(process.env.CLAUDE_DIR || path.join(process.env.HOME || "", ".claude"))}" 2>/dev/null`, { encoding: "utf-8" }).trim().split(/\s+/)[0];
        const projSize = execSync(`du -sh "${PROJECTS_DIR}" 2>/dev/null`, { encoding: "utf-8" }).trim().split(/\s+/)[0];
        console.log("Storage:");
        console.log(`  Total:         ${totalSize}`);
        console.log(`  Projects:      ${projSize}`);
      } catch { /* du not available */ }
    });

  // --- clean ---
  session
    .command("clean")
    .description("Delete session JSONL files older than N days")
    .option("-d, --days <n>", "Delete files older than this many days", "30")
    .option("--dry-run", "Show what would be deleted without deleting")
    .action((opts: { days: string; dryRun?: boolean }) => {
      const days = parseInt(opts.days, 10);
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      let deleted = 0;
      let freed = 0;

      const walk = (dir: string): void => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.name.endsWith(".jsonl")) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.mtimeMs < cutoffMs) {
                const size = stat.size;
                if (opts.dryRun) {
                  console.log(`[dry-run] would delete: ${fullPath}  (${Math.floor(size / 1024)}KB)`);
                } else {
                  fs.unlinkSync(fullPath);
                  console.log(`Deleted: ${fullPath}`);
                }
                deleted++;
                freed += size;
              }
            } catch { /* skip */ }
          }
        }
      };

      walk(PROJECTS_DIR);

      console.log("");
      const verb = opts.dryRun ? "Would delete" : "Deleted";
      console.log(`${verb} ${deleted} file(s) (~${Math.floor(freed / 1024)}KB freed)`);
    });

  return session;
}
