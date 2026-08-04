/**
 * Run budgets (I7): wall-clock and idle limits for agent runs.
 *
 * Pure helpers — engine/gateway call these; terminal reason codes are stable
 * strings mapped to human copy in the UI.
 */

/** Stable terminal reason codes (never free-form for budget stops). */
export const RUN_BUDGET_REASON = {
  WALL_EXCEEDED: "budget_wall_exceeded",
  IDLE_EXCEEDED: "budget_idle_exceeded",
  MAX_TURNS: "budget_max_turns",
} as const;

export type RunBudgetReasonCode =
  (typeof RUN_BUDGET_REASON)[keyof typeof RUN_BUDGET_REASON];

export type RunBudgetLimits = {
  /** Max wall-clock ms from run start (0 / undefined = disabled). */
  maxWallMs?: number;
  /** Max ms since last activity (tool/message/progress) (0 = disabled). */
  maxIdleMs?: number;
  /** Max agent turns (0 = disabled). */
  maxTurns?: number;
};

export type RunBudgetState = {
  startedAtMs: number;
  lastActivityAtMs: number;
  turnCount: number;
  limits: Required<RunBudgetLimits>;
};

/** Product defaults — generous enough for long coding sessions, stops runaways. */
export const DEFAULT_RUN_BUDGET_LIMITS: Required<RunBudgetLimits> = {
  maxWallMs: 4 * 60 * 60 * 1000, // 4 hours
  maxIdleMs: 30 * 60 * 1000, // 30 minutes idle
  maxTurns: 0, // disabled until turn accounting is universal
};

/**
 * Resolve run budget limits from env (product path for TaskRunner + engine-grok).
 * Shared so headless and gateway cannot drift (I20 characterization).
 */
export function runBudgetLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Required<RunBudgetLimits> {
  const wall = Number(env.GROKDESK_RUN_MAX_WALL_MS ?? 0);
  const idle = Number(env.GROKDESK_RUN_MAX_IDLE_MS ?? 0);
  const turns = Number(env.GROKDESK_RUN_MAX_TURNS ?? 0);
  return {
    maxWallMs: wall > 0 ? wall : DEFAULT_RUN_BUDGET_LIMITS.maxWallMs,
    maxIdleMs: idle > 0 ? idle : DEFAULT_RUN_BUDGET_LIMITS.maxIdleMs,
    maxTurns: turns > 0 ? turns : DEFAULT_RUN_BUDGET_LIMITS.maxTurns,
  };
}

export function createRunBudgetState(
  nowMs: number,
  limits?: RunBudgetLimits,
): RunBudgetState {
  return {
    startedAtMs: nowMs,
    lastActivityAtMs: nowMs,
    turnCount: 0,
    limits: {
      maxWallMs: limits?.maxWallMs ?? DEFAULT_RUN_BUDGET_LIMITS.maxWallMs,
      maxIdleMs: limits?.maxIdleMs ?? DEFAULT_RUN_BUDGET_LIMITS.maxIdleMs,
      maxTurns: limits?.maxTurns ?? DEFAULT_RUN_BUDGET_LIMITS.maxTurns,
    },
  };
}

export function touchRunBudgetActivity(
  state: RunBudgetState,
  nowMs: number,
): RunBudgetState {
  return { ...state, lastActivityAtMs: nowMs };
}

export function incrementRunBudgetTurn(
  state: RunBudgetState,
  nowMs: number,
): RunBudgetState {
  return {
    ...state,
    turnCount: state.turnCount + 1,
    lastActivityAtMs: nowMs,
  };
}

export type RunBudgetCheck =
  | { ok: true }
  | { ok: false; code: RunBudgetReasonCode; message: string };

/**
 * Evaluate whether the run should stop for budget reasons.
 * Pure: pass clock explicitly for tests.
 */
export function checkRunBudget(
  state: RunBudgetState,
  nowMs: number,
): RunBudgetCheck {
  const { maxWallMs, maxIdleMs, maxTurns } = state.limits;

  if (maxWallMs > 0 && nowMs - state.startedAtMs >= maxWallMs) {
    return {
      ok: false,
      code: RUN_BUDGET_REASON.WALL_EXCEEDED,
      message: `Run stopped: wall-clock budget (${Math.round(maxWallMs / 60_000)} min) exceeded`,
    };
  }

  if (maxIdleMs > 0 && nowMs - state.lastActivityAtMs >= maxIdleMs) {
    return {
      ok: false,
      code: RUN_BUDGET_REASON.IDLE_EXCEEDED,
      message: `Run stopped: idle budget (${Math.round(maxIdleMs / 60_000)} min without activity) exceeded`,
    };
  }

  if (maxTurns > 0 && state.turnCount >= maxTurns) {
    return {
      ok: false,
      code: RUN_BUDGET_REASON.MAX_TURNS,
      message: `Run stopped: turn budget (${maxTurns}) reached`,
    };
  }

  return { ok: true };
}

/** i18n key for a budget terminal reason (UI maps to human string). */
export function runBudgetReasonLabelKey(code: string): string | null {
  switch (code) {
    case RUN_BUDGET_REASON.WALL_EXCEEDED:
      return "budget.wallExceeded";
    case RUN_BUDGET_REASON.IDLE_EXCEEDED:
      return "budget.idleExceeded";
    case RUN_BUDGET_REASON.MAX_TURNS:
      return "budget.maxTurns";
    default:
      return null;
  }
}

export function isRunBudgetReason(code: string | null | undefined): boolean {
  if (!code) return false;
  return (
    code === RUN_BUDGET_REASON.WALL_EXCEEDED ||
    code === RUN_BUDGET_REASON.IDLE_EXCEEDED ||
    code === RUN_BUDGET_REASON.MAX_TURNS
  );
}
