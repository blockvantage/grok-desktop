import { describe, expect, it } from "vitest";
import {
  SESSION_STATUS_ABSENT,
  decodeSessionStatus,
  latestSessionStatusFromEvents,
  projectSessionStatusHeader,
} from "./session-status.js";

describe("decodeSessionStatus", () => {
  it("keeps absent numeric fields null instead of 0", () => {
    const snap = decodeSessionStatus({
      sessionUpdate: "session_status",
      schema_version: 1,
      model: { id: "grok-4.5", display_name: "Grok 4.5" },
    });
    expect(snap.modelDisplayName).toBe("Grok 4.5");
    expect(snap.totalCostUsd).toBeNull();
    expect(snap.contextWindowSize).toBeNull();
    expect(snap.usedPercentage).toBeNull();
    expect(snap.turnStartedAtMs).toBeNull();
    expect(snap.autoCompactThresholdPercent).toBeNull();
  });

  it("preserves an explicit empty context of 0", () => {
    const snap = decodeSessionStatus({
      schema_version: 1,
      context_window: {
        context_tokens: 0,
        used_percentage: 0,
        context_window_size: 256000,
      },
    });
    expect(snap.contextTokens).toBe(0);
    expect(snap.usedPercentage).toBe(0);
    expect(snap.contextWindowSize).toBe(256000);
  });

  it("never throws on garbage", () => {
    expect(() => decodeSessionStatus(null)).not.toThrow();
    expect(() => decodeSessionStatus("nope")).not.toThrow();
    expect(decodeSessionStatus({ nested: true }).modelDisplayName).toBeNull();
  });
});

describe("projectSessionStatusHeader", () => {
  it("renders em dashes for missing cost/context/timer, never 0", () => {
    const view = projectSessionStatusHeader(
      decodeSessionStatus({
        schema_version: 1,
        model: { display_name: "Grok 4.5" },
        workspace: { branch: "main" },
      }),
      1_700_000_000_000,
    );
    expect(view.model).toBe("Grok 4.5");
    expect(view.context).toBe(SESSION_STATUS_ABSENT);
    expect(view.cost).toBe(SESSION_STATUS_ABSENT);
    expect(view.turnTimer).toBe(SESSION_STATUS_ABSENT);
    expect(view.branch).toBe("main");
    expect(view.worktree).toBe(SESSION_STATUS_ABSENT);
    expect(view.contextRatio).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/:"0"|:0[,}]/);
  });

  it("formats live context, cost, and turn timer when present", () => {
    const view = projectSessionStatusHeader(
      decodeSessionStatus({
        schema_version: 1,
        context_window: {
          used_percentage: 72,
          auto_compact_threshold_percent: 70,
        },
        cost: { total_cost_usd: 0.12 },
        turn: { started_at_ms: 1_000 },
      }),
      13_000,
    );
    expect(view.context).toBe("72%");
    expect(view.cost).toBe("$0.12");
    expect(view.turnTimer).toBe("12s");
    expect(view.compactSuggested).toBe(true);
  });
});

describe("latestSessionStatusFromEvents", () => {
  it("reads the newest session_status step", () => {
    const snap = latestSessionStatusFromEvents([
      {
        kind: "step",
        payload: {
          title: "session_status",
          status: { model: { display_name: "old" } },
        },
      },
      {
        kind: "step",
        payload: {
          title: "session_status",
          model: { display_name: "Grok 4.5" },
          cost: { total_cost_usd: 1.5 },
        },
      },
    ]);
    expect(snap?.modelDisplayName).toBe("Grok 4.5");
    expect(snap?.totalCostUsd).toBe(1.5);
  });
});
