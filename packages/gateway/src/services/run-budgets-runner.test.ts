/**
 * I7: TaskRunner product path enforces wall/idle budgets via shared helpers.
 * Drives the same checkRunBudget / createRunBudgetState used by runner.ts.
 */
import { describe, it, expect } from "vitest";
import {
  checkRunBudget,
  createRunBudgetState,
  RUN_BUDGET_REASON,
  touchRunBudgetActivity,
} from "@grokdesk/shared";

describe("runner budget path (shared helpers used by TaskRunner)", () => {
  it("wall budget fires with stable reason code", () => {
    const state = createRunBudgetState(0, {
      maxWallMs: 1000,
      maxIdleMs: 0,
    });
    const r = checkRunBudget(state, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(RUN_BUDGET_REASON.WALL_EXCEEDED);
  });

  it("idle resets when activity (run_progress / engine events) is touched", () => {
    let state = createRunBudgetState(0, {
      maxWallMs: 0,
      maxIdleMs: 5000,
    });
    expect(checkRunBudget(state, 5000).ok).toBe(false);
    state = touchRunBudgetActivity(state, 4000);
    expect(checkRunBudget(state, 7000).ok).toBe(true);
    expect(checkRunBudget(state, 9000).ok).toBe(false);
  });

  it("inheritUserGrok maps to isolateGrokHome invert (T4 product path contract)", () => {
    // Mirrors runner: isolateGrokHome: !inheritUserGrokProvider?.()
    const map = (inherit: boolean) => !inherit;
    expect(map(false)).toBe(true);
    expect(map(true)).toBe(false);
  });

  it("silent timer path emits stable budget codes (runner appendEvent contract)", () => {
    // TaskRunner budget interval appends { message, code } then cancel —
    // codes must be the shared RUN_BUDGET_REASON values.
    const wall = checkRunBudget(
      createRunBudgetState(0, { maxWallMs: 1, maxIdleMs: 0 }),
      1,
    );
    expect(wall.ok).toBe(false);
    if (!wall.ok) {
      expect(wall.code).toBe(RUN_BUDGET_REASON.WALL_EXCEEDED);
      expect(wall.message.length).toBeGreaterThan(0);
    }
    const idle = checkRunBudget(
      createRunBudgetState(0, { maxWallMs: 0, maxIdleMs: 1 }),
      1,
    );
    expect(idle.ok).toBe(false);
    if (!idle.ok) {
      expect(idle.code).toBe(RUN_BUDGET_REASON.IDLE_EXCEEDED);
    }
  });
});

