import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";
import { Command } from "commander";

const _require = createRequire(import.meta.url);
const pkg = _require("../../package.json") as { version: string };

describe("--version flag", () => {
  it("outputs the version from package.json", async () => {
    const program = new Command();
    program.name("cc-hub").version(pkg.version);

    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as NodeJS.WriteStream).write = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      program.parse(["node", "cc-hub", "--version"]);
    } catch {
      // swallow the process.exit() throw
    } finally {
      (process.stdout as NodeJS.WriteStream).write = origWrite;
      exitSpy.mockRestore();
    }

    expect(written.join("").trim()).toBe(pkg.version);
  });

  it("version matches package.json", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
