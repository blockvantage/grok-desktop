import { describe, expect, it } from "vitest";
import { planEventHistoryBanner } from "./event-history-status";

describe("planEventHistoryBanner", () => {
  it("shows nothing while loading", () => {
    expect(
      planEventHistoryBanner({
        loading: true,
        error: "x",
        staleSince: "t",
        truncated: true,
      }).kind,
    ).toBe("none");
  });

  it("surfaces stale/error with retry (AC4)", () => {
    const b = planEventHistoryBanner({
      error: "gateway unavailable",
      staleSince: "2026-08-03T00:00:00.000Z",
      truncated: false,
    });
    expect(b.kind).toBe("stale");
    expect(b.showRetry).toBe(true);
    expect(b.testId).toBe("event-history-stale");
    expect(b.messageKey).toBe("workspace.eventsStale");
  });

  it("surfaces truncated with retry when history hit safety budget", () => {
    const b = planEventHistoryBanner({
      error: null,
      staleSince: null,
      truncated: true,
    });
    expect(b.kind).toBe("truncated");
    expect(b.showRetry).toBe(true);
    expect(b.testId).toBe("event-history-truncated");
  });

  it("prefers stale over truncated so recovery is actionable", () => {
    const b = planEventHistoryBanner({
      error: "timeout",
      staleSince: "t",
      truncated: true,
    });
    expect(b.kind).toBe("stale");
  });

  it("is quiet when history is healthy", () => {
    expect(
      planEventHistoryBanner({
        error: null,
        staleSince: null,
        truncated: false,
      }).kind,
    ).toBe("none");
  });
});
