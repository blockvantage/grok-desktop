import { describe, it, expect } from "vitest";
import {
  primaryWorkspaceRoot,
  projectWorkspaceRoots,
  filterArtifactsForTask,
  filterArtifactsForTasks,
} from "./task-workspace-meta";

describe("task-workspace-meta", () => {
  it("primaryWorkspaceRoot uses first root", () => {
    expect(
      primaryWorkspaceRoot({
        policySnapshot: { workspaceRoots: ["/managed", "/project"] },
      }),
    ).toBe("/managed");
    expect(primaryWorkspaceRoot({ policySnapshot: { workspaceRoots: [] } })).toBe(
      "",
    );
    expect(primaryWorkspaceRoot({})).toBe("");
  });

  it("projectWorkspaceRoots drops primary", () => {
    expect(
      projectWorkspaceRoots({
        policySnapshot: { workspaceRoots: ["/m", "/a", "/b"] },
      }),
    ).toEqual(["/a", "/b"]);
    expect(
      projectWorkspaceRoots({ policySnapshot: { workspaceRoots: ["/only"] } }),
    ).toEqual([]);
  });

  it("filterArtifactsForTask", () => {
    const arts = [
      { taskId: "t1", path: "a" },
      { taskId: "t2", path: "b" },
      { taskId: "t1", path: "c" },
    ];
    expect(filterArtifactsForTask(arts, "t1")).toEqual([
      { taskId: "t1", path: "a" },
      { taskId: "t1", path: "c" },
    ]);
  });

  it("filters artifacts for every turn in a conversation", () => {
    const arts = [
      { taskId: "root", path: "brief.md" },
      { taskId: "follow-up", path: "site.html" },
      { taskId: "other-chat", path: "unrelated.png" },
    ];
    expect(filterArtifactsForTasks(arts, ["root", "follow-up"])).toEqual([
      { taskId: "root", path: "brief.md" },
      { taskId: "follow-up", path: "site.html" },
    ]);
  });
});
