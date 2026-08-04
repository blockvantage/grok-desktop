import { describe, it, expect } from "vitest";
import {
  cleanChatTitle,
  chatContainsSelectedTurn,
  disambiguateScanTitles,
  normalizeGoalScanTitle,
  preferredChatScanTitle,
  SCAN_TITLE_MAX,
} from "./chat-title";

describe("cleanChatTitle", () => {
  it("trims and rejects empty", () => {
    expect(cleanChatTitle("  Hello  ")).toBe("Hello");
    expect(cleanChatTitle("   ")).toBeNull();
    expect(cleanChatTitle("")).toBeNull();
  });
});

describe("chatContainsSelectedTurn", () => {
  it("detects selected turn in chat", () => {
    expect(
      chatContainsSelectedTurn([{ id: "a" }, { id: "b" }], "b"),
    ).toBe(true);
    expect(chatContainsSelectedTurn([{ id: "a" }], "x")).toBe(false);
    expect(chatContainsSelectedTurn(undefined, "a")).toBe(false);
    expect(chatContainsSelectedTurn([{ id: "a" }], null)).toBe(false);
  });
});

describe("normalizeGoalScanTitle (Task 15)", () => {
  it("caps long goals for scanning, not full raw dump", () => {
    const long =
      "Write a comprehensive multi-section research brief covering market sizing competitive landscape pricing strategy and go-to-market motions for enterprise SaaS";
    const t = normalizeGoalScanTitle(long);
    expect(t.length).toBeLessThanOrEqual(SCAN_TITLE_MAX);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toBe(long);
  });

  it("uses first line / short sentence when compact", () => {
    expect(normalizeGoalScanTitle("Fix the login bug. Then ship.")).toBe(
      "Fix the login bug.",
    );
    expect(normalizeGoalScanTitle("line one\nline two ignored")).toBe(
      "line one",
    );
  });

  it("handles empty/whitespace, non-Latin, and emoji", () => {
    expect(normalizeGoalScanTitle("   ")).toBe("");
    expect(normalizeGoalScanTitle("整理下载文件夹并分类")).toContain("整理");
    expect(normalizeGoalScanTitle("🚀 launch plan for Q3")).toMatch(/🚀/);
  });
});

describe("preferredChatScanTitle", () => {
  it("prefers generated short title over goal", () => {
    expect(
      preferredChatScanTitle({
        title: "Cat essay",
        goal: "Write a very long essay about cats that would otherwise dump",
      }),
    ).toBe("Cat essay");
  });

  it("falls back to normalized goal when title missing", () => {
    const t = preferredChatScanTitle({
      title: null,
      goal: "Organize my downloads folder carefully please",
    });
    expect(t.toLowerCase()).toContain("organize");
    expect(t.length).toBeLessThanOrEqual(SCAN_TITLE_MAX);
  });
});

describe("disambiguateScanTitles", () => {
  it("appends workspace or date when fallback titles collide", () => {
    const map = disambiguateScanTitles([
      {
        id: "a",
        scanTitle: "Organize downloads",
        workspaceName: "/Users/me/Downloads",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "b",
        scanTitle: "Organize downloads",
        workspaceName: "/Users/me/Desktop",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      {
        id: "c",
        scanTitle: "Unique title",
        workspaceName: null,
      },
    ]);
    expect(map.get("c")).toBe("Unique title");
    expect(map.get("a")).toMatch(/Organize downloads · Downloads/);
    expect(map.get("b")).toMatch(/Organize downloads · Desktop/);
  });
});
