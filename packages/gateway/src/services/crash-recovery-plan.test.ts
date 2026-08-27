import { describe, it, expect } from "vitest";
import {
  shouldInterruptTaskStatus,
  planTaskInterruptOnRestart,
  shouldCompleteOpenAttempt,
} from "./crash-recovery-plan.js";

describe("crash-recovery-plan", () => {
  it("interrupts only running / waiting_approval", () => {
    expect(shouldInterruptTaskStatus("running")).toBe(true);
    expect(shouldInterruptTaskStatus("waiting_approval")).toBe(true);
    expect(shouldInterruptTaskStatus("queued")).toBe(false);
    expect(shouldInterruptTaskStatus("done")).toBe(false);
    expect(shouldInterruptTaskStatus("failed")).toBe(false);
  });

  it("plans interrupt with durable error code and attempt reason", () => {
    const plan = planTaskInterruptOnRestart("running");
    expect(plan.kind).toBe("interrupt");
    if (plan.kind !== "interrupt") return;
    expect(plan.terminalStatus).toBe("failed");
    expect(plan.eventCode).toBe("interrupted_on_restart");
    expect(plan.eventMessage).toMatch(/restart/i);
    expect(plan.attemptTerminal).toBe("interrupted");
    expect(plan.attemptReason).toBe("gateway_restart");
  });

  it("requeues running tasks that have a provider session instead of failing", () => {
    const plan = planTaskInterruptOnRestart("running", {
      providerSessionId: "sess-1",
    });
    expect(plan).toEqual({ kind: "resume", requeueStatus: "queued" });
    const noSession = planTaskInterruptOnRestart("running", {
      providerSessionId: null,
    });
    expect(noSession.kind).toBe("interrupt");
  });

  it("skips terminal and queued statuses", () => {
    expect(planTaskInterruptOnRestart("queued")).toEqual({ kind: "skip" });
    expect(planTaskInterruptOnRestart("done")).toEqual({ kind: "skip" });
  });

  it("completes only non-terminal open attempts", () => {
    expect(
      shouldCompleteOpenAttempt({ hasLatest: true, isTerminal: false }),
    ).toBe(true);
    expect(
      shouldCompleteOpenAttempt({ hasLatest: true, isTerminal: true }),
    ).toBe(false);
    expect(
      shouldCompleteOpenAttempt({ hasLatest: false, isTerminal: false }),
    ).toBe(false);
  });
});
