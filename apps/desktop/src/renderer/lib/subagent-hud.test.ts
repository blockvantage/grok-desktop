import { describe, it, expect } from "vitest";
import {
  buildSubagentHud,
  buildSubagentHudFromWorkers,
  isLikelySubagent,
} from "./subagent-hud";

describe("buildSubagentHud", () => {
  it("hides when no truthful workers (never infers from parentTaskId)", () => {
    const tasks = [
      {
        id: "r",
        parentTaskId: null,
        status: "done" as const,
        title: "Main",
        goal: "g",
      },
      {
        id: "f1",
        parentTaskId: "r",
        status: "running" as const,
        title: "Follow-up",
        goal: "more",
      },
    ];
    // Follow-up turns are NOT workers.
    expect(isLikelySubagent(tasks[1]!, tasks)).toBe(false);
    const hud = buildSubagentHud({
      rootId: "r",
      tasks,
      latestEventsByTaskId: {},
    });
    expect(hud).toBeNull();
  });

  it("surfaces only truthful worker lifecycle records", () => {
    const hud = buildSubagentHudFromWorkers([
      {
        id: "w1",
        runId: "r1",
        parentWorkerId: null,
        label: "Research",
        objective: "dig",
        status: "running",
        currentActivity: "browser open",
      },
      {
        id: "w2",
        runId: "r1",
        parentWorkerId: null,
        label: "Writer",
        objective: "write",
        status: "running",
        currentActivity: null,
      },
    ]);
    expect(hud).not.toBeNull();
    expect(hud!.activeCount).toBe(2);
    expect(hud!.items).toHaveLength(2);
    expect(hud!.items.find((i) => i.taskId === "w1")?.currentStep).toMatch(
      /browser/i,
    );
  });

  it("buildSubagentHud accepts workers feed", () => {
    const hud = buildSubagentHud({
      rootId: "r",
      tasks: [],
      latestEventsByTaskId: {},
      workersAvailable: true,
      workers: [
        {
          id: "w1",
          runId: "r1",
          parentWorkerId: null,
          label: "Agent",
          objective: null,
          status: "done",
          currentActivity: null,
        },
      ],
    });
    expect(hud?.items[0]?.taskId).toBe("w1");
  });
});
