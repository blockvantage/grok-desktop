import { describe, it, expect } from "vitest";
import { projectConversation } from "./conversation-projector";
import type { Task, TaskEvent } from "@grokdesk/shared";

function task(id: string, goal: string, createdAt: string): Task {
  return {
    id,
    goal,
    title: null,
    mode: "interactive",
    status: "done",
    model: "grok-4.5",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/w"],
      allowShell: true,
      allowNetworkTools: true,
    },
    projectId: null,
    parentTaskId: id === "t0" ? null : "t0",
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
  };
}

describe("projector rewound turns", () => {
  it("marks turns with rewound status_change as superseded", () => {
    const eventsByTask: Record<string, TaskEvent[]> = {
      t0: [],
      t1: [
        {
          id: "e1",
          taskId: "t1",
          seq: 1,
          kind: "status_change",
          payload: {
            status: "cancelled",
            reason: "rewound",
            pointId: "1",
            message: "Rewound to before this message",
          },
          createdAt: "2026-01-01T00:00:02.000Z",
        },
      ],
      t2: [
        {
          id: "e2",
          taskId: "t2",
          seq: 1,
          kind: "status_change",
          payload: {
            status: "cancelled",
            reason: "rewound",
            pointId: "1",
          },
          createdAt: "2026-01-01T00:00:03.000Z",
        },
      ],
    };
    const snap = projectConversation({
      conversationId: "t0",
      title: "chat",
      tasks: [
        task("t0", "root", "2026-01-01T00:00:00.000Z"),
        task("t1", "turn1", "2026-01-01T00:00:01.000Z"),
        task("t2", "turn2", "2026-01-01T00:00:02.000Z"),
      ],
      eventsByTask,
    });
    expect(snap.turns.find((t) => t.id === "t0")?.superseded).toBe(false);
    expect(snap.turns.find((t) => t.id === "t1")?.superseded).toBe(true);
    expect(snap.turns.find((t) => t.id === "t2")?.superseded).toBe(true);
  });
});
