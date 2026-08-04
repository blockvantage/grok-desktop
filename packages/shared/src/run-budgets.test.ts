import { describe, it, expect } from "vitest";
import {
  checkRunBudget,
  createRunBudgetState,
  incrementRunBudgetTurn,
  isRunBudgetReason,
  RUN_BUDGET_REASON,
  runBudgetReasonLabelKey,
  touchRunBudgetActivity,
} from "./run-budgets.js";

describe("run budgets", () => {
  it("allows run within wall and idle limits", () => {
    const state = createRunBudgetState(1_000, {
      maxWallMs: 10_000,
      maxIdleMs: 5_000,
    });
    expect(checkRunBudget(state, 2_000)).toEqual({ ok: true });
  });

  it("stops on wall-clock exceeded with stable reason code", () => {
    const state = createRunBudgetState(0, {
      maxWallMs: 1000,
      maxIdleMs: 0,
    });
    const r = checkRunBudget(state, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(RUN_BUDGET_REASON.WALL_EXCEEDED);
      expect(isRunBudgetReason(r.code)).toBe(true);
      expect(runBudgetReasonLabelKey(r.code)).toBe("budget.wallExceeded");
    }
  });

  it("stops on idle exceeded; activity touch resets idle", () => {
    let state = createRunBudgetState(0, {
      maxWallMs: 0,
      maxIdleMs: 1000,
    });
    expect(checkRunBudget(state, 1000).ok).toBe(false);
    state = touchRunBudgetActivity(state, 900);
    expect(checkRunBudget(state, 1500).ok).toBe(true);
    expect(checkRunBudget(state, 1900).ok).toBe(false);
  });

  it("stops on max turns", () => {
    let state = createRunBudgetState(0, {
      maxWallMs: 0,
      maxIdleMs: 0,
      maxTurns: 2,
    });
    state = incrementRunBudgetTurn(state, 10);
    expect(checkRunBudget(state, 20).ok).toBe(true);
    state = incrementRunBudgetTurn(state, 30);
    const r = checkRunBudget(state, 40);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(RUN_BUDGET_REASON.MAX_TURNS);
  });

  it("disabled limits (0) never fire", () => {
    const state = createRunBudgetState(0, {
      maxWallMs: 0,
      maxIdleMs: 0,
      maxTurns: 0,
    });
    expect(checkRunBudget(state, 999_999_999)).toEqual({ ok: true });
  });
});

describe("runBudgetLimitsFromEnv", () => {
  it("uses defaults when env unset", async () => {
    const { runBudgetLimitsFromEnv, DEFAULT_RUN_BUDGET_LIMITS } = await import(
      "./run-budgets.js"
    );
    const lim = runBudgetLimitsFromEnv({});
    expect(lim.maxWallMs).toBe(DEFAULT_RUN_BUDGET_LIMITS.maxWallMs);
    expect(lim.maxIdleMs).toBe(DEFAULT_RUN_BUDGET_LIMITS.maxIdleMs);
  });

  it("honors env overrides", async () => {
    const { runBudgetLimitsFromEnv } = await import("./run-budgets.js");
    const lim = runBudgetLimitsFromEnv({
      GROKDESK_RUN_MAX_WALL_MS: "60000",
      GROKDESK_RUN_MAX_IDLE_MS: "12000",
    });
    expect(lim.maxWallMs).toBe(60_000);
    expect(lim.maxIdleMs).toBe(12_000);
  });
});

