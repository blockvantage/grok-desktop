import { describe, expect, it } from "vitest";
import {
  emptyActivityStore,
  reduceActivity,
  visibleTimelineEvents,
  workersForHud,
} from "./activity-store";

describe("activity-store", () => {
  it("keeps one live working block per run", () => {
    let s = emptyActivityStore();
    s = reduceActivity(s, {
      type: "live_work",
      id: "l1",
      runId: "r1",
      timestamp: "t1",
      summary: "Reading files",
    });
    s = reduceActivity(s, {
      type: "live_work",
      id: "l2",
      runId: "r1",
      timestamp: "t2",
      summary: "Updating 3 files",
    });
    const live = s.events.filter((e) => e.kind === "live_work");
    expect(live).toHaveLength(1);
    expect(live[0]?.summary).toBe("Updating 3 files");
    expect(s.liveSummary).toBe("Updating 3 files");
  });

  it("folds completed work into phases and clears live", () => {
    let s = emptyActivityStore();
    s = reduceActivity(s, {
      type: "live_work",
      id: "l1",
      runId: "r1",
      timestamp: "t1",
      summary: "Working",
    });
    s = reduceActivity(s, {
      type: "phase_complete",
      id: "p1",
      runId: "r1",
      timestamp: "t2",
      summary: "Reviewed 12 files",
    });
    expect(s.events.some((e) => e.kind === "live_work")).toBe(false);
    expect(s.events.find((e) => e.kind === "phase")?.summary).toBe(
      "Reviewed 12 files",
    );
  });

  it("does not replay a removed live event over newer progress", () => {
    let s = emptyActivityStore();
    s = reduceActivity(s, {
      type: "live_work",
      id: "old-live",
      runId: "r1",
      timestamp: "t1",
      summary: "Old progress",
    });
    s = reduceActivity(s, {
      type: "live_work",
      id: "new-live",
      runId: "r1",
      timestamp: "t2",
      summary: "New progress",
    });
    s = reduceActivity(s, {
      type: "live_work",
      id: "old-live",
      runId: "r1",
      timestamp: "t1",
      summary: "Replayed stale progress",
    });

    expect(s.liveSummary).toBe("New progress");
    expect(s.events.filter((entry) => entry.kind === "live_work")).toEqual([
      expect.objectContaining({ id: "new-live", summary: "New progress" }),
    ]);
  });

  it("does not replay a removed live event after phase completion", () => {
    let s = emptyActivityStore();
    s = reduceActivity(s, {
      type: "live_work",
      id: "old-live",
      runId: "r1",
      timestamp: "t1",
      summary: "Old progress",
    });
    s = reduceActivity(s, {
      type: "phase_complete",
      id: "phase",
      runId: "r1",
      timestamp: "t2",
      summary: "Completed phase",
    });
    s = reduceActivity(s, {
      type: "live_work",
      id: "old-live",
      runId: "r1",
      timestamp: "t1",
      summary: "Replayed stale progress",
    });

    expect(s.liveSummary).toBeNull();
    expect(s.events.some((entry) => entry.kind === "live_work")).toBe(false);
    expect(s.events.find((entry) => entry.id === "phase")?.summary).toBe(
      "Completed phase",
    );
  });

  it("rejects distinct-ID live progress older than the current observation", () => {
    let s = emptyActivityStore();
    s = reduceActivity(s, {
      type: "live_work",
      id: "new-live",
      runId: "r1",
      timestamp: "t2",
      summary: "New progress",
    });
    s = reduceActivity(s, {
      type: "live_work",
      id: "different-old-live",
      runId: "r1",
      timestamp: "t1",
      summary: "Distinct stale progress",
    });

    expect(s.liveSummary).toBe("New progress");
    expect(s.events.filter((entry) => entry.kind === "live_work")).toEqual([
      expect.objectContaining({ id: "new-live", summary: "New progress" }),
    ]);
  });

  it("orders phase and live observations without stale folding or resurrection", () => {
    let afterPhase = emptyActivityStore();
    afterPhase = reduceActivity(afterPhase, {
      type: "phase_complete",
      id: "new-phase",
      runId: "r1",
      timestamp: "t3",
      summary: "Completed phase",
    });
    afterPhase = reduceActivity(afterPhase, {
      type: "live_work",
      id: "distinct-old-live",
      runId: "r1",
      timestamp: "t2",
      summary: "Old live work",
    });
    afterPhase = reduceActivity(afterPhase, {
      type: "live_work",
      id: "same-time-live",
      runId: "r1",
      timestamp: "t3",
      summary: "Same-time live work",
    });

    expect(afterPhase.liveSummary).toBeNull();
    expect(
      afterPhase.events.some((entry) => entry.kind === "live_work"),
    ).toBe(false);

    let afterLive = emptyActivityStore();
    afterLive = reduceActivity(afterLive, {
      type: "live_work",
      id: "new-live",
      runId: "r2",
      timestamp: "t3",
      summary: "New live work",
    });
    afterLive = reduceActivity(afterLive, {
      type: "phase_complete",
      id: "distinct-old-phase",
      runId: "r2",
      timestamp: "t2",
      summary: "Old phase",
    });

    expect(afterLive.liveSummary).toBe("New live work");
    expect(afterLive.events).toEqual([
      expect.objectContaining({ id: "new-live", kind: "live_work" }),
    ]);
  });

  it("keeps approvals in causal order with messages", () => {
    let s = emptyActivityStore();
    s = reduceActivity(s, {
      type: "user_message",
      id: "u1",
      runId: "r1",
      timestamp: "t1",
      text: "Do it",
    });
    s = reduceActivity(s, {
      type: "approval",
      id: "a1",
      runId: "r1",
      timestamp: "t2",
      summary: "Allow shell?",
    });
    s = reduceActivity(s, {
      type: "assistant_message",
      id: "m1",
      runId: "r1",
      timestamp: "t3",
      text: "Done",
    });
    expect(visibleTimelineEvents(s).map((e) => e.kind)).toEqual([
      "user_message",
      "approval",
      "assistant_message",
    ]);
  });

  it("hides workers until truthful lifecycle events arrive", () => {
    let s = emptyActivityStore();
    expect(workersForHud(s)).toEqual([]);
    s = reduceActivity(s, {
      type: "worker_started",
      id: "e1",
      runId: "r1",
      workerId: "w1",
      timestamp: "t1",
      label: "Researcher",
    });
    expect(s.workersAvailable).toBe(true);
    expect(workersForHud(s)).toHaveLength(1);
    s = reduceActivity(s, {
      type: "worker_completed",
      id: "e2",
      runId: "r1",
      workerId: "w1",
      timestamp: "t2",
    });
    expect(workersForHud(s)[0]?.status).toBe("done");
  });

  it("preserves terminal worker state and parent identity under late lifecycle events", () => {
    let s = emptyActivityStore();
    s = reduceActivity(s, {
      type: "worker_completed",
      id: "done",
      runId: "r1",
      workerId: "w1",
      parentWorkerId: "parent-1",
      timestamp: "t3",
      summary: "Final result",
    });
    s = reduceActivity(s, {
      type: "worker_started",
      id: "start",
      runId: "r1",
      workerId: "w1",
      parentWorkerId: null,
      timestamp: "t1",
      label: "Researcher",
    });
    s = reduceActivity(s, {
      type: "worker_activity",
      id: "late-progress",
      runId: "r1",
      workerId: "w1",
      parentWorkerId: null,
      timestamp: "t4",
      summary: "Late progress",
    });
    s = reduceActivity(s, {
      type: "worker_failed",
      id: "failed",
      runId: "r1",
      workerId: "w1",
      parentWorkerId: null,
      timestamp: "t5",
      summary: "Failure wins deterministically",
    });
    s = reduceActivity(s, {
      type: "worker_activity",
      id: "late-progress",
      runId: "r1",
      workerId: "w1",
      parentWorkerId: null,
      timestamp: "t4",
      summary: "Duplicate must not mutate",
    });

    expect(s.workers.w1).toEqual(
      expect.objectContaining({
        label: "Researcher",
        parentWorkerId: "parent-1",
        status: "failed",
        currentActivity: null,
      }),
    );
    expect(
      s.events.filter((entry) => entry.id === "late-progress"),
    ).toHaveLength(1);
  });

  it("keeps raw logs behind progressive disclosure", () => {
    let s = emptyActivityStore();
    s = reduceActivity(s, {
      type: "log",
      id: "log1",
      runId: "r1",
      timestamp: "t1",
      summary: "debug",
      detail: "raw",
    });
    expect(visibleTimelineEvents(s)).toHaveLength(0);
    expect(visibleTimelineEvents(s, { includeLogs: true })).toHaveLength(1);
  });
});
