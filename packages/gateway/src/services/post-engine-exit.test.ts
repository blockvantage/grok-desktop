import { describe, it, expect } from "vitest";
import { planPostEngineExit } from "./post-engine-exit.js";
import { ENGINE_ENDED_WAITING_MESSAGE } from "./provider-gate-receipts.js";

describe("planPostEngineExit", () => {
  it("no-ops for missing, cancelled, or unexpected statuses", () => {
    expect(planPostEngineExit({ status: undefined, sawError: false })).toEqual({
      kind: "noop",
    });
    expect(planPostEngineExit({ status: "cancelled", sawError: true })).toEqual(
      { kind: "noop" },
    );
    expect(planPostEngineExit({ status: "succeeded", sawError: false })).toEqual(
      { kind: "noop" },
    );
  });

  it("fails closed when engine ends while parked on approval", () => {
    const plan = planPostEngineExit({
      status: "waiting_approval",
      sawError: false,
    });
    expect(plan).toEqual({
      kind: "failed_waiting",
      errorMessage: ENGINE_ENDED_WAITING_MESSAGE,
      attemptStatus: "failed",
      attemptReason: "engine_ended_waiting_approval",
    });
    expect(plan.kind === "failed_waiting" && plan.errorMessage).toMatch(
      /approval/i,
    );
  });

  it("completes running tasks with harvest and terminal status", () => {
    expect(
      planPostEngineExit({ status: "running", sawError: false }),
    ).toEqual({
      kind: "complete_running",
      harvest: true,
      status: "done",
      attemptReason: "completed",
    });
    expect(planPostEngineExit({ status: "running", sawError: true })).toEqual({
      kind: "complete_running",
      harvest: true,
      status: "failed",
      attemptReason: "engine_error",
    });
  });
});
