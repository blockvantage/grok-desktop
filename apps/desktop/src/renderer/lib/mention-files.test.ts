import { describe, expect, it } from "vitest";
import {
  extractMentionQuery,
  filterMentionCandidates,
  insertMentionToken,
  mentionDisplayLabel,
  mentionSecondaryLabel,
} from "./mention-files";

describe("mentions", () => {
  it("extracts @query at cursor", () => {
    expect(extractMentionQuery("see @bri", 8)).toEqual({
      start: 4,
      query: "bri",
    });
    expect(extractMentionQuery("email a@b.com", 13)).toBeNull();
  });

  it("filters by name", () => {
    const c = filterMentionCandidates(
      [
        { path: "/ws/brief.md", name: "brief.md", group: "attached" },
        { path: "/ws/other.txt", name: "other.txt", group: "project" },
      ],
      "bri",
    );
    expect(c).toHaveLength(1);
    expect(c[0]!.name).toBe("brief.md");
  });

  it("filters by relative label under root", () => {
    const c = filterMentionCandidates(
      [
        {
          path: "/proj/src/lib/foo.ts",
          name: "foo.ts",
          group: "project",
        },
      ],
      "src/lib",
      8,
      ["/proj"],
    );
    expect(c).toHaveLength(1);
  });

  it("dedupes by path", () => {
    const c = filterMentionCandidates(
      [
        { path: "/ws/a.md", name: "a.md", group: "attached" },
        { path: "/ws/a.md", name: "a.md", group: "project" },
      ],
      "",
    );
    expect(c).toHaveLength(1);
  });

  it("mentionDisplayLabel prefers workspace-relative path", () => {
    expect(mentionDisplayLabel("/proj/src/a.ts", ["/proj"])).toBe("src/a.ts");
    expect(mentionDisplayLabel("/proj/src/a.ts", [])).toBe("a.ts");
    expect(mentionDisplayLabel("/other/x.md", ["/proj"])).toBe("x.md");
  });

  it("inserts seamless short token, not absolute path", () => {
    const r = insertMentionToken(
      "see @bri",
      8,
      4,
      "/proj/brief.md",
      ["/proj"],
    );
    expect(r.text).toBe("see @brief.md ");
    expect(r.cursor).toBe(r.text.length);
    expect(r.label).toBe("brief.md");
  });

  it("inserts relative path token when nested under root", () => {
    const r = insertMentionToken(
      "@",
      1,
      0,
      "/Users/me/app/src/lib/util.ts",
      ["/Users/me/app"],
    );
    expect(r.text).toBe("@src/lib/util.ts ");
  });

  it("quotes labels with spaces", () => {
    const r = insertMentionToken("x @f", 4, 2, "/ws/my file.md", ["/ws"]);
    expect(r.text).toBe("x @`my file.md` ");
  });

  it("secondary label shortens outside roots", () => {
    const s = mentionSecondaryLabel(
      "/Users/maceo/deep/nested/folder/file.ts",
      [],
    );
    expect(s.startsWith("~/") || s.startsWith("…/")).toBe(true);
    expect(s).not.toContain("/Users/maceo/deep/nested");
  });
});
