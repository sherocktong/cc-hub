import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseChangelogHtml } from "../../src/claude-version/fetcher.js";
import { getPinnedVersion, setPinnedVersion } from "../../src/claude-version/utils.js";
import { MacOSDesktopApp, WindowsDesktopApp, NoOpDesktopApp } from "../../src/platform/desktop-app.js";
import { SystemBinaryResolver, getClaudeVersion } from "../../src/platform/binary-resolver.js";

// ---------------------------------------------------------------------------
// parseChangelogHtml
// ---------------------------------------------------------------------------

describe("parseChangelogHtml", () => {
  it("extracts versions from contenteditable divs", () => {
    const html = `
      <div contenteditable="false">2.1.173</div>
      <p>June 11, 2026</p>
      <div contenteditable="false">2.1.172</div>
      <p>June 10, 2026</p>
      <div contenteditable="false">2.1.170</div>
    `;
    const result = parseChangelogHtml(html);
    expect(result).toEqual([
      { version: "2.1.173", date: "June 11, 2026" },
      { version: "2.1.172", date: "June 10, 2026" },
      { version: "2.1.170", date: "" },
    ]);
  });

  it("extracts versions from heading tags as fallback", () => {
    const html = `
      <h2>2.1.100</h2>
      <p>May 1, 2026</p>
      <h3>2.1.99</h3>
      <p>April 30, 2026</p>
    `;
    const result = parseChangelogHtml(html);
    expect(result).toEqual([
      { version: "2.1.100", date: "May 1, 2026" },
      { version: "2.1.99", date: "April 30, 2026" },
    ]);
  });

  it("deduplicates versions found in both divs and headings", () => {
    const html = `
      <div contenteditable="false">2.1.50</div>
      <h2>2.1.50</h2>
      <p>March 1, 2026</p>
    `;
    const result = parseChangelogHtml(html);
    expect(result).toHaveLength(1);
    // The <p> is within 500 chars of the div, so the date is picked up from the first pass
    expect(result[0]).toEqual({ version: "2.1.50", date: "March 1, 2026" });
  });

  it("returns empty array for HTML with no versions", () => {
    const html = `<html><body><p>No versions here</p></body></html>`;
    const result = parseChangelogHtml(html);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getPinnedVersion / setPinnedVersion
// ---------------------------------------------------------------------------

describe("pinned version settings", () => {
  let mockSettings: Record<string, unknown> = {};

  beforeEach(() => {
    mockSettings = {};
    vi.doMock("../../src/config.js", () => ({
      SETTINGS_FILE: "/mock/settings.json",
      ensureSettingsFile: vi.fn(),
      readJson: vi.fn(() => ({ ...mockSettings })),
      writeJson: vi.fn((_: string, data: unknown) => {
        // Replace contents rather than merge, so deletions are reflected
        Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
        Object.assign(mockSettings, data);
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("../../src/config.js");
  });

  it("reads pinned version from settings", async () => {
    mockSettings.minimumVersion = "2.1.168";
    mockSettings.requiredMaximumVersion = "2.1.168";
    const { getPinnedVersion } = await import("../../src/claude-version/utils.js");
    expect(getPinnedVersion()).toBe("2.1.168");
  });

  it("returns undefined when min/max versions differ", async () => {
    mockSettings.minimumVersion = "2.1.160";
    mockSettings.requiredMaximumVersion = "2.1.170";
    const { getPinnedVersion } = await import("../../src/claude-version/utils.js");
    expect(getPinnedVersion()).toBeUndefined();
  });

  it("returns undefined when no version is pinned", async () => {
    const { getPinnedVersion } = await import("../../src/claude-version/utils.js");
    expect(getPinnedVersion()).toBeUndefined();
  });

  it("writes pinned version and min/max version to settings", async () => {
    const { setPinnedVersion, getPinnedVersion } = await import("../../src/claude-version/utils.js");
    setPinnedVersion("2.1.170");
    expect(getPinnedVersion()).toBe("2.1.170");
    expect(mockSettings._cc_hub_pinnedClaudeVersion).toBeUndefined();
    expect(mockSettings.minimumVersion).toBe("2.1.170");
    expect(mockSettings.requiredMaximumVersion).toBe("2.1.170");
  });

  it("clears pinned version and min/max version when set to undefined", async () => {
    mockSettings.minimumVersion = "2.1.168";
    mockSettings.requiredMaximumVersion = "2.1.168";
    const { setPinnedVersion, getPinnedVersion } = await import("../../src/claude-version/utils.js");
    setPinnedVersion(undefined);
    expect(getPinnedVersion()).toBeUndefined();
    expect(mockSettings.minimumVersion).toBeUndefined();
    expect(mockSettings.requiredMaximumVersion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MacOSDesktopApp.findBinary with pinned version
// ---------------------------------------------------------------------------

describe("MacOSDesktopApp.findBinary", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.restoreAllMocks();
  });

  it("returns latest version when no pin is set", () => {
    const app = new MacOSDesktopApp();
    vi.spyOn(require("node:fs"), "existsSync").mockReturnValue(true);
    vi.spyOn(require("node:fs"), "readdirSync").mockReturnValue(["2.1.100", "2.1.99", "2.1.101"]);

    const result = app.findBinary();
    expect(result).toContain("2.1.101");
  });

  it("returns pinned version when it exists locally", () => {
    const app = new MacOSDesktopApp();
    vi.spyOn(require("node:fs"), "existsSync").mockReturnValue(true);
    vi.spyOn(require("node:fs"), "readdirSync").mockReturnValue(["2.1.100", "2.1.99", "2.1.101"]);

    const result = app.findBinary("2.1.99");
    expect(result).toContain("2.1.99");
  });

  it("falls back to latest when pinned version is not found", () => {
    const app = new MacOSDesktopApp();
    vi.spyOn(require("node:fs"), "existsSync").mockReturnValue(true);
    vi.spyOn(require("node:fs"), "readdirSync").mockReturnValue(["2.1.100", "2.1.99"]);

    const result = app.findBinary("2.1.200");
    expect(result).toContain("2.1.100");
  });
});

// ---------------------------------------------------------------------------
// SystemBinaryResolver with pinned version
// ---------------------------------------------------------------------------

describe("SystemBinaryResolver.resolve", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
  });

  it("uses desktop app binary with pinned version", async () => {
    vi.doMock("node:child_process", () => ({
      spawnSync: vi.fn().mockReturnValue({ status: 1, stdout: "", stderr: "" }),
    }));

    const { SystemBinaryResolver } = await import("../../src/platform/binary-resolver.js");
    const mockApp = new MacOSDesktopApp();
    vi.spyOn(mockApp, "findBinary").mockReturnValue("/mock/2.1.99/claude");

    const resolver = new SystemBinaryResolver(mockApp);
    const result = resolver.resolve("2.1.99");
    expect(result).toBe("/mock/2.1.99/claude");
    expect(mockApp.findBinary).toHaveBeenCalledWith("2.1.99");
  });
});
