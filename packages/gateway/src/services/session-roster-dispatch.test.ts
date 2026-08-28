import { describe, expect, it, vi } from "vitest";
import {
  dispatchSessionRosterMethod,
  isSessionRosterMethod,
} from "./session-roster-dispatch.js";
import type { Task } from "@grokdesk/shared";

function task(partial: Partial<Task> & Pick<Task, "id" | "goal">): Task {
  return {
    title: null,
    mode: "interactive",
    status: "done",
    model: "grok-4.5",
    effort: "normal",
    planFirst: false,
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/ws"],
      allowNetworkTools: true,
      allowShell: false,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    attachments: [],
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    completedAt: "2026-08-26T00:00:00.000Z",
    ...partial,
  };
}

describe("session roster dispatch", () => {
  it("recognizes the three session IPC methods", () => {
    expect(isSessionRosterMethod("sessions.search")).toBe(true);
    expect(isSessionRosterMethod("sessions.list")).toBe(true);
    expect(isSessionRosterMethod("sessions.foreignList")).toBe(true);
    expect(isSessionRosterMethod("tasks.list")).toBe(false);
  });

  it("searches Desk chats and overlays ACP bootstrapping without dropping desk hits", async () => {
    const view = (await dispatchSessionRosterMethod(
      "sessions.search",
      { query: "brief" },
      {
        listTasks: () => [
          task({ id: "desk", title: "Launch brief", goal: "Write Q3" }),
          task({ id: "other", title: "Kitchen", goal: "Cook pasta" }),
        ],
        searchAcp: async () => ({
          status: "bootstrapping",
          headless: "exclude",
          hits: [
            {
              sessionId: "cli",
              title: "Engine only",
              lastTurnSummary: "Still indexing",
              updatedAt: null,
              activity: "idle",
              headless: false,
            },
          ],
        }),
      },
    )) as { status: string; hits: Array<{ sessionId: string }> };
    expect(view.status).toBe("bootstrapping");
    expect(view.hits.map((h) => h.sessionId)).toEqual(["desk", "cli"]);
  });

  it("lists roster rows even with an empty query and fails open when ACP throws", async () => {
    const view = (await dispatchSessionRosterMethod(
      "sessions.list",
      {},
      {
        listTasks: () => [
          task({ id: "a", title: "A", goal: "Alpha" }),
          task({ id: "b", title: "B", goal: "Beta" }),
        ],
        listAcp: async () => {
          throw new Error("cli down");
        },
      },
    )) as { status: string; hits: Array<{ sessionId: string }> };
    expect(view.status).toBe("ready");
    expect(view.hits.map((h) => h.sessionId)).toEqual(["a", "b"]);
  });

  it("foreignList uses the injected scanner", async () => {
    const scanForeign = vi.fn(() => [
      {
        tool: "claude" as const,
        nativeId: "s1",
        title: "Fix login",
        cwd: "/repo",
        updatedAt: "2026-08-27T00:00:00.000Z",
        branch: null,
      },
    ]);
    const list = await dispatchSessionRosterMethod(
      "sessions.foreignList",
      { cwd: "/repo" },
      {
        listTasks: () => [],
        scanForeign,
      },
    );
    expect(scanForeign).toHaveBeenCalledWith({ cwd: "/repo" });
    expect(list).toHaveLength(1);
  });
});
