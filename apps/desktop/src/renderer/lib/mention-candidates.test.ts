import { describe, it, expect } from "vitest";
import {
  attachedMentionCandidates,
  deliverableMentionCandidates,
  mentionRootsFromProjects,
  mergeProjectFileMentions,
} from "./mention-candidates";

describe("mention-candidates", () => {
  it("maps attachments and deliverables", () => {
    expect(
      attachedMentionCandidates([
        { sourcePath: "/a.png", name: "a.png" },
      ]),
    ).toEqual([
      { path: "/a.png", name: "a.png", group: "attached" },
    ]);
    expect(
      deliverableMentionCandidates([
        { path: "/out.md", title: "Report" },
        { path: null, title: "No path" },
      ]),
    ).toEqual([
      { path: "/out.md", name: "Report", group: "deliverable" },
    ]);
  });

  it("merges project lists without dirs or duplicates", () => {
    const merged = mergeProjectFileMentions([
      [
        { name: "a.ts", path: "/ws/a.ts", isDir: false },
        { name: "sub", path: "/ws/sub", isDir: true },
      ],
      [
        { name: "a.ts", path: "/ws/a.ts", isDir: false },
        { name: "b.ts", path: "/ws/b.ts", isDir: false },
      ],
    ]);
    expect(merged.map((m) => m.path)).toEqual(["/ws/a.ts", "/ws/b.ts"]);
  });

  it("filters empty roots", () => {
    expect(mentionRootsFromProjects(["/a", "  ", ""])).toEqual(["/a"]);
  });
});
