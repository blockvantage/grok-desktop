import { describe, expect, it } from "vitest";
import {
  claudeProjectDirName,
  finishForeignScan,
  foreignContinuePrompt,
  summarizeForeignFile,
} from "./foreign-sessions.js";

const now = Date.parse("2026-08-27T12:00:00.000Z");

describe("foreign sessions", () => {
  it("reads Claude jsonl metadata without importing the transcript", () => {
    const head = [
      JSON.stringify({
        cwd: "/repo",
        type: "user",
        message: { content: "Fix the login bug" },
      }),
      JSON.stringify({ customTitle: "Auth repair" }),
    ].join("\n");
    const summary = summarizeForeignFile(
      {
        tool: "claude",
        path: "/home/me/.claude/projects/-repo/abc.jsonl",
        nativeId: "abc",
        mtimeMs: now - 1000,
        head,
      },
      { nowMs: now, cwd: "/repo" },
    );
    expect(summary?.title).toBe("Auth repair");
    expect(summary?.tool).toBe("claude");
    expect(summary?.cwd).toBe("/repo");
    expect(foreignContinuePrompt(summary!)).toContain("Claude Code");
    expect(foreignContinuePrompt(summary!)).toContain("Auth repair");
  });

  it("drops sessions older than 30 days and cwd mismatches", () => {
    const old = summarizeForeignFile(
      {
        tool: "codex",
        path: "x.jsonl",
        nativeId: "old",
        mtimeMs: now - 40 * 24 * 3600_000,
        head: JSON.stringify({ title: "Ancient", cwd: "/repo" }),
      },
      { nowMs: now },
    );
    expect(old).toBeNull();
    const mismatch = summarizeForeignFile(
      {
        tool: "cursor",
        path: "y.jsonl",
        nativeId: "y",
        mtimeMs: now,
        head: JSON.stringify({ title: "Other", cwd: "/other" }),
      },
      { nowMs: now, cwd: "/repo" },
    );
    expect(mismatch).toBeNull();
  });

  it("caps per tool and sorts newest first", () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      tool: "claude" as const,
      path: `${i}.jsonl`,
      nativeId: `id-${i}`,
      mtimeMs: now - i * 1000,
      head: JSON.stringify({ title: `T${i}`, cwd: "/repo" }),
    }));
    const list = finishForeignScan(entries, { nowMs: now });
    expect(list.map((s) => s.nativeId)).toEqual(["id-0", "id-1", "id-2"]);
  });

  it("encodes Claude project folder names", () => {
    expect(claudeProjectDirName("/Users/me/app")).toBe("-Users-me-app");
  });
});
