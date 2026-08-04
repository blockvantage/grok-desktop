import type { Task } from "@grokdesk/shared";
import { describe, expect, it } from "vitest";
import { resolveHistoryCutoffId } from "./run-context.js";

function task(over: Partial<Task>): Task {
  return {
    id: "task",
    goal: "goal",
    title: null,
    mode: "interactive",
    status: "queued",
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/tmp"],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    completedAt: null,
    ...over,
  };
}

describe("resolveHistoryCutoffId", () => {
  it("uses the normal parent for an ordinary follow-up", () => {
    const current = task({ id: "child", parentTaskId: "parent" });
    expect(resolveHistoryCutoffId(current, () => null)).toBe("parent");
  });

  it("cuts a revision off at the source parent", () => {
    const source = task({ id: "source", parentTaskId: "source-parent" });
    const revision = task({
      id: "revision",
      parentTaskId: source.id,
      revisionOfTaskId: source.id,
    });

    expect(
      resolveHistoryCutoffId(revision, (id) =>
        id === source.id ? source : null,
      ),
    ).toBe("source-parent");
  });

  it("returns no history when revising the root turn", () => {
    const source = task({ id: "root", parentTaskId: null });
    const revision = task({
      id: "revision",
      parentTaskId: source.id,
      revisionOfTaskId: source.id,
    });

    expect(resolveHistoryCutoffId(revision, () => source)).toBeNull();
  });

  it("walks repeated revision lineage to the original branch predecessor", () => {
    const original = task({ id: "a", parentTaskId: "predecessor" });
    const revisionB = task({
      id: "b",
      parentTaskId: original.id,
      revisionOfTaskId: original.id,
    });
    const revisionC = task({
      id: "c",
      parentTaskId: revisionB.id,
      revisionOfTaskId: revisionB.id,
    });
    const tasks = new Map([
      [original.id, original],
      [revisionB.id, revisionB],
    ]);
    expect(resolveHistoryCutoffId(revisionC, (id) => tasks.get(id))).toBe(
      "predecessor",
    );
  });

  it("fails closed for missing or cyclic revision lineage", () => {
    const missing = task({
      id: "missing-revision",
      revisionOfTaskId: "gone",
    });
    expect(resolveHistoryCutoffId(missing, () => null)).toBeNull();

    const a = task({ id: "a", revisionOfTaskId: "b" });
    const b = task({ id: "b", revisionOfTaskId: "a" });
    const tasks = new Map([
      [a.id, a],
      [b.id, b],
    ]);
    expect(resolveHistoryCutoffId(a, (id) => tasks.get(id))).toBeNull();
  });
});
