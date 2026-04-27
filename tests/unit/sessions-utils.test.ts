import { describe, it, expect, vi } from "vitest";
import { encodePath, decodePath } from "../../src/sessions/codec.js";
import {
  formatTimestamp,
  snippet,
  extractText,
} from "../../src/sessions/utils.js";

// ---------------------------------------------------------------------------
// encodePath / decodePath
// ---------------------------------------------------------------------------

describe("encodePath", () => {
  it("replaces forward slashes with dashes", () => {
    expect(encodePath("/home/user/project")).toBe("-home-user-project");
  });

  it("replaces dots with dashes", () => {
    expect(encodePath("/home/user/my.project")).toBe("-home-user-my-project");
  });

  it("handles paths with dots and slashes together", () => {
    const encoded = encodePath("/Users/alice/dev/cc-hub");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain(".");
  });

  it("replaces Windows backslashes with dashes", () => {
    expect(encodePath("C:\\Users\\foo\\project")).toBe("C-Users-foo-project");
  });

  it("strips Windows drive colons", () => {
    expect(encodePath("C:\\Users\\foo\\.project")).toBe("C-Users-foo--project");
  });
});

describe("decodePath", () => {
  it("decodes a double-dash to slash-dot", () => {
    expect(decodePath("-home-user--claude")).toBe("/home/user/.claude");
  });

  it("decodes a leading single dash to a slash", () => {
    expect(decodePath("-home-user-project")).toBe("/home/user/project");
  });

  it("uses backslashes on Windows", () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      expect(decodePath("C-Users-foo--project")).toBe("C:\\Users\\foo\\.project");
    } finally {
      platformSpy.mockRestore();
    }
  });
});

describe("encodePath <-> decodePath round-trip", () => {
  // Note: paths with literal hyphens cannot round-trip (hyphens encode identically to slashes)
  const unixPaths = [
    "/Users/alice/Documents/project",
    "/home/user/.claude",
    "/tmp/testdir",
  ];

  for (const p of unixPaths) {
    it(`round-trips ${p} on Unix`, () => {
      const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
      try {
        expect(decodePath(encodePath(p))).toBe(p);
      } finally {
        platformSpy.mockRestore();
      }
    });
  }

  const windowsPaths = [
    "C:\\Users\\alice\\Documents\\project",
    "C:\\Users\\foo\\.claude",
    "D:\\tmp\\testdir",
  ];

  for (const p of windowsPaths) {
    it(`round-trips ${p} on Windows`, () => {
      const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      try {
        expect(decodePath(encodePath(p))).toBe(p);
      } finally {
        platformSpy.mockRestore();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  it("formats epoch 0 as a date string", () => {
    const result = formatTimestamp(0);
    // Should contain year, month, day, hour, minute components
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("formats a known timestamp correctly (UTC offset-aware)", () => {
    // 2024-01-15 12:30 UTC in ms
    const ts = new Date("2024-01-15T12:30:00Z").getTime();
    const result = formatTimestamp(ts);
    // The result is in local time so we just verify the format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("pads single-digit month and day", () => {
    // January 5 — month=01, day=05
    const ts = new Date("2024-01-05T00:00:00Z").getTime();
    const result = formatTimestamp(ts);
    // Month and day should be two digits
    const parts = result.split("-");
    expect(parts[1].length).toBe(2);
    expect(parts[2].split(" ")[0].length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// snippet
// ---------------------------------------------------------------------------

describe("snippet", () => {
  it("returns beginning of text when query is not found", () => {
    const text = "The quick brown fox";
    expect(snippet(text, "zebra", 10)).toBe("The quick ");
  });

  it("centers the snippet around the match", () => {
    const text = "aaaa MATCH bbbb";
    const result = snippet(text, "MATCH", 10);
    expect(result).toContain("MATCH");
  });

  it("adds ellipsis prefix when snippet starts mid-text", () => {
    const text = "x".repeat(100) + "TARGET" + "y".repeat(100);
    const result = snippet(text, "TARGET", 30);
    expect(result.startsWith("...")).toBe(true);
  });

  it("adds ellipsis suffix when snippet ends before end of text", () => {
    const text = "TARGET" + "x".repeat(200);
    const result = snippet(text, "TARGET", 30);
    expect(result.endsWith("...")).toBe(true);
  });

  it("does not add ellipsis when text fits within width", () => {
    const text = "short text TARGET end";
    const result = snippet(text, "TARGET", 200);
    expect(result).toBe(text);
  });

  it("performs case-insensitive search for the anchor position", () => {
    // snippet uses text.toLowerCase().indexOf(query.toLowerCase()) internally
    const text = "hello MATCH world";
    const result = snippet(text, "match", 10);
    expect(result).toContain("MATCH");
  });
});

// ---------------------------------------------------------------------------
// extractText
// ---------------------------------------------------------------------------

describe("extractText", () => {
  it("extracts text from a message.content string", () => {
    const d = { message: { role: "user", content: "Hello world" } };
    expect(extractText(d)).toEqual({ role: "user", text: "Hello world" });
  });

  it("extracts text from a message.content array with text block", () => {
    const d = {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Response here" }],
      },
    };
    expect(extractText(d)).toEqual({ role: "assistant", text: "Response here" });
  });

  it("returns empty strings when content has no text blocks", () => {
    const d = {
      message: {
        role: "user",
        content: [{ type: "image", source: {} }],
      },
    };
    expect(extractText(d)).toEqual({ role: "", text: "" });
  });

  it("extracts text from top-level content string (no message wrapper)", () => {
    const d = { type: "summary", content: "Session started" };
    const result = extractText(d as Record<string, unknown>);
    expect(result.text).toBe("Session started");
    expect(result.role).toBe("summary");
  });

  it("uses d.operation as role fallback", () => {
    const d = { operation: "compacted", content: "result" };
    const result = extractText(d as Record<string, unknown>);
    expect(result.role).toBe("compacted");
  });

  it("returns empty strings for empty object", () => {
    expect(extractText({})).toEqual({ role: "", text: "" });
  });
});
