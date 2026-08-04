import type { Task } from "@grokdesk/shared";
import { describe, expect, it } from "vitest";
import { buildChats, findChat } from "./chats";

function task(
  id: string,
  status: Task["status"],
  createdAt: string,
  parentTaskId: string | null,
): Task {
  return {
    id,
    goal: id,
    title: null,
    mode: "interactive",
    status,
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: [],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId,
    revisionOfTaskId: null,
    attachments: [],
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt,
    updatedAt: createdAt,
    completedAt: status === "done" ? createdAt : null,
  };
}

describe("buildChats", () => {
  it("selects the greatest task id as latest when timestamps tie", () => {
    const root = task("root", "done", "2026-01-01T00:00:00.000Z", null);
    const terminal = task(
      "task-a",
      "done",
      "2026-01-01T00:10:00.000Z",
      root.id,
    );
    const live = task(
      "task-z",
      "running",
      "2026-01-01T00:10:00.000Z",
      root.id,
    );

    const chat = findChat(buildChats([root, live, terminal]), live.id);
    expect(chat?.turns.map((turn) => turn.id)).toEqual([
      "root",
      "task-a",
      "task-z",
    ]);
    expect(chat?.latest.id).toBe("task-z");
    expect(chat?.latest.status).toBe("running");
  });
});
