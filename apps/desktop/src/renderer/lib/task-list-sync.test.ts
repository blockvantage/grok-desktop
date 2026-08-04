import { describe, it, expect } from "vitest";
import {
  mergeServerTasksWithOptimistic,
  listNewlyFinishedTasks,
  buildTaskStatusMap,
  remapSelectedTaskId,
} from "./task-list-sync";
import type { Task } from "@grokdesk/shared";

function t(id: string, status: Task["status"] = "queued"): Task {
  return {
    id,
    goal: id,
    title: null,
    mode: "interactive",
    status,
    model: "m",
    effort: "fast",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: [],
      allowShell: false,
      allowNetworkTools: false,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    attachments: [],
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: "t",
    updatedAt: "t",
    completedAt: null,
  };
}

describe("mergeServerTasksWithOptimistic", () => {
  it("returns server list when no optimistic rows", () => {
    const server = [t("a"), t("b")];
    expect(mergeServerTasksWithOptimistic([t("old")], server)).toEqual(server);
  });

  it("prefixes optimistic rows ahead of server when not reconciled", () => {
    const opt = { ...t("optimistic-1"), goal: "Write a brief" };
    const prev = [opt, t("a")];
    const server = [t("a"), t("b")];
    const merged = mergeServerTasksWithOptimistic(prev, server);
    expect(merged.map((x) => x.id)).toEqual([
      "optimistic-1",
      "a",
      "b",
    ]);
  });

  it("drops optimistic once server has the same goal session", () => {
    const opt = {
      ...t("optimistic-99"),
      goal: "Generate a T-rex image",
      createdAt: "2026-07-15T12:00:00.000Z",
    };
    const real = {
      ...t("real-1"),
      goal: "Generate a T-rex image",
      createdAt: "2026-07-15T12:00:01.000Z",
    };
    const merged = mergeServerTasksWithOptimistic(
      [opt],
      [real, t("other")],
      Date.parse("2026-07-15T12:00:05.000Z"),
    );
    expect(merged.map((x) => x.id)).toEqual(["real-1", "other"]);
  });

  it("remaps selection from optimistic id to real task", () => {
    const opt = {
      ...t("optimistic-99"),
      goal: "Website of a dolphin",
      createdAt: "2026-07-15T12:00:00.000Z",
    };
    const real = {
      ...t("real-1"),
      goal: "Website of a dolphin",
      createdAt: "2026-07-15T12:00:01.000Z",
    };
    const prev = [opt, t("a")];
    const next = [real, t("a")];
    expect(
      remapSelectedTaskId(
        "optimistic-99",
        prev,
        next,
        Date.parse("2026-07-15T12:00:05.000Z"),
      ),
    ).toBe("real-1");
    expect(remapSelectedTaskId("real-1", prev, next)).toBe("real-1");
    expect(remapSelectedTaskId(null, prev, next)).toBeNull();
  });
});

describe("listNewlyFinishedTasks", () => {
  it("returns empty when prev map is empty (boot seed)", () => {
    expect(
      listNewlyFinishedTasks([t("a", "done")], new Map()),
    ).toEqual([]);
  });

  it("detects running → done and running → failed", () => {
    const prev = buildTaskStatusMap([
      t("a", "running"),
      t("b", "running"),
      t("c", "done"),
    ]);
    const next = [
      t("a", "done"),
      t("b", "failed"),
      t("c", "done"),
      t("d", "done"), // new id — no prior
    ];
    const finished = listNewlyFinishedTasks(next, prev);
    expect(finished.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("ignores already-terminal previous status", () => {
    const prev = buildTaskStatusMap([t("a", "failed")]);
    expect(listNewlyFinishedTasks([t("a", "failed")], prev)).toEqual([]);
  });
});
