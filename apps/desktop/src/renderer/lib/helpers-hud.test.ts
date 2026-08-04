import { describe, it, expect } from "vitest";
import {
  parentTaskIdNeverImpliesHelper,
  projectHelpersHud,
} from "./helpers-hud";
import type { WorkerRecord } from "./activity-store";

describe("projectHelpersHud (C4)", () => {
  it("returns null without workers", () => {
    expect(projectHelpersHud({ workers: [] })).toBeNull();
    expect(projectHelpersHud({ workers: null })).toBeNull();
  });

  it("returns null when workersAvailable is false (headless)", () => {
    const workers: WorkerRecord[] = [
      {
        id: "w1",
        runId: "r1",
        parentWorkerId: null,
        label: "Explore",
        status: "running",
        currentActivity: "Searching",
        objective: null,
      },
    ];
    expect(
      projectHelpersHud({ workers, workersAvailable: false }),
    ).toBeNull();
  });

  it("shows real workers only", () => {
    const workers: WorkerRecord[] = [
      {
        id: "w1",
        runId: "r1",
        parentWorkerId: null,
        label: "Research",
        status: "running",
        currentActivity: "Reading docs",
        objective: "Find API",
      },
    ];
    const hud = projectHelpersHud({ workers, workersAvailable: true });
    expect(hud).not.toBeNull();
    expect(hud!.items).toHaveLength(1);
    expect(hud!.items[0]!.name).toMatch(/Research/);
  });

  it("never invents helpers from parentTaskId", () => {
    expect(parentTaskIdNeverImpliesHelper()).toBe(true);
  });
});
