import { describe, it, expect } from "vitest";
import {
  applyReviewFileAction,
  projectReviewChanges,
} from "./review-changes";

describe("projectReviewChanges (C2)", () => {
  it("returns null when no file events", () => {
    expect(
      projectReviewChanges([
        { kind: "message", payload: { text: "hi" } },
      ]),
    ).toBeNull();
  });

  it("collects write tool paths", () => {
    const v = projectReviewChanges([
      {
        kind: "tool_request",
        payload: { tool: "write_file", path: "/ws/src/a.ts" },
      },
      {
        kind: "tool_request",
        payload: { tool: "Edit", path: "/ws/src/b.ts" },
      },
    ]);
    expect(v).not.toBeNull();
    expect(v!.files.map((f) => f.path).sort()).toEqual([
      "/ws/src/a.ts",
      "/ws/src/b.ts",
    ]);
  });

  it("includes artifact_created paths", () => {
    const v = projectReviewChanges([
      {
        kind: "artifact_created",
        payload: { path: "/ws/out/report.md", title: "Report" },
      },
    ]);
    expect(v?.files[0]?.path).toBe("/ws/out/report.md");
  });

  it("dedupes same path", () => {
    const v = projectReviewChanges([
      {
        kind: "tool_request",
        payload: { tool: "write_file", path: "/ws/a.ts" },
      },
      {
        kind: "tool_result",
        payload: { tool: "write_file", path: "/ws/a.ts", ok: true },
      },
    ]);
    expect(v!.files).toHaveLength(1);
  });

  it("applyReviewFileAction keep/undo removes path from strip", () => {
    const v = projectReviewChanges([
      {
        kind: "tool_request",
        payload: { tool: "write_file", path: "/ws/a.ts" },
      },
      {
        kind: "tool_request",
        payload: { tool: "write_file", path: "/ws/b.ts" },
      },
    ])!;
    const afterKeep = applyReviewFileAction(v, "/ws/a.ts", "keep");
    expect(afterKeep!.files.map((f) => f.path)).toEqual(["/ws/b.ts"]);
    const afterUndo = applyReviewFileAction(afterKeep!, "/ws/b.ts", "undo");
    expect(afterUndo).toBeNull();
  });
});
