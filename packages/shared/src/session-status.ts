/**
 * ACP SessionStatus snapshot (Phase 1.2).
 * Snake_case wire payload (`schema_version: 1`). Absent fields stay null —
 * never coerced to 0 — so the UI can render "—" honestly.
 */

export const SESSION_STATUS_ABSENT = "—";

export type SessionStatusSnapshot = {
  schemaVersion: number;
  modelId: string | null;
  modelDisplayName: string | null;
  contextWindowSize: number | null;
  contextTokens: number | null;
  usedPercentage: number | null;
  autoCompactThresholdPercent: number | null;
  totalCostUsd: number | null;
  turnStartedAtMs: number | null;
  branch: string | null;
  gitWorktree: string | null;
  effortLevel: string | null;
};

export type SessionStatusHeaderView = {
  model: string;
  context: string;
  cost: string;
  turnTimer: string;
  branch: string;
  worktree: string;
  /** 0–100 when known; null when the window is unknown (degraded meter). */
  contextRatio: number | null;
  compactSuggested: boolean;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function unwrapStatus(raw: unknown): Record<string, unknown> | null {
  const obj = rec(raw);
  if (!obj) return null;
  const nested = rec(obj.status) ?? rec(obj.session_status);
  if (nested && (nested.schema_version != null || nested.model != null || nested.context_window != null)) {
    return nested;
  }
  return obj;
}

/**
 * Decode a SessionStatus session/update payload. Unknown/malformed input
 * yields an empty snapshot (all nulls), never throws.
 */
export function decodeSessionStatus(raw: unknown): SessionStatusSnapshot {
  const obj = unwrapStatus(raw) ?? {};
  const model = rec(obj.model);
  const context = rec(obj.context_window);
  const cost = rec(obj.cost);
  const turn = rec(obj.turn);
  const workspace = rec(obj.workspace);
  const worktree = rec(obj.worktree);
  const effort = rec(obj.effort);
  const schemaVersion = optionalNumber(obj.schema_version) ?? 1;
  return {
    schemaVersion,
    modelId: optionalString(model?.id),
    modelDisplayName: optionalString(model?.display_name),
    contextWindowSize: optionalNumber(context?.context_window_size),
    contextTokens: optionalNumber(context?.context_tokens),
    usedPercentage: optionalNumber(context?.used_percentage),
    autoCompactThresholdPercent: optionalNumber(
      context?.auto_compact_threshold_percent,
    ),
    totalCostUsd: optionalNumber(cost?.total_cost_usd),
    turnStartedAtMs: optionalNumber(turn?.started_at_ms),
    branch: optionalString(workspace?.branch),
    gitWorktree:
      optionalString(workspace?.git_worktree) ??
      optionalString(worktree?.name),
    effortLevel: optionalString(effort?.level),
  };
}

function formatCost(usd: number | null): string {
  if (usd == null) return SESSION_STATUS_ABSENT;
  if (usd < 0.005) return SESSION_STATUS_ABSENT;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatElapsed(startedAtMs: number | null, nowMs: number): string {
  if (startedAtMs == null) return SESSION_STATUS_ABSENT;
  const elapsed = Math.max(0, nowMs - startedAtMs);
  const sec = Math.floor(elapsed / 1000);
  if (sec < 1) return SESSION_STATUS_ABSENT;
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

function formatContext(pct: number | null): string {
  if (pct == null) return SESSION_STATUS_ABSENT;
  return `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
}

/**
 * Project a SessionStatus snapshot into header copy. Missing numbers render
 * as "—", never as 0.
 */
export function projectSessionStatusHeader(
  snap: SessionStatusSnapshot | null | undefined,
  nowMs: number = Date.now(),
): SessionStatusHeaderView {
  if (!snap) {
    return {
      model: SESSION_STATUS_ABSENT,
      context: SESSION_STATUS_ABSENT,
      cost: SESSION_STATUS_ABSENT,
      turnTimer: SESSION_STATUS_ABSENT,
      branch: SESSION_STATUS_ABSENT,
      worktree: SESSION_STATUS_ABSENT,
      contextRatio: null,
      compactSuggested: false,
    };
  }
  const threshold = snap.autoCompactThresholdPercent ?? 80;
  const compactSuggested =
    snap.usedPercentage != null && snap.usedPercentage >= threshold;
  return {
    model: snap.modelDisplayName ?? SESSION_STATUS_ABSENT,
    context: formatContext(snap.usedPercentage),
    cost: formatCost(snap.totalCostUsd),
    turnTimer: formatElapsed(snap.turnStartedAtMs, nowMs),
    branch: snap.branch ?? SESSION_STATUS_ABSENT,
    worktree: snap.gitWorktree ?? SESSION_STATUS_ABSENT,
    contextRatio:
      snap.usedPercentage == null
        ? null
        : Math.max(0, Math.min(100, snap.usedPercentage)),
    compactSuggested,
  };
}

export function latestSessionStatusFromEvents(
  events: ReadonlyArray<{ kind: string; payload: Record<string, unknown> }>,
): SessionStatusSnapshot | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind !== "step") continue;
    if (ev.payload.title !== "session_status") continue;
    const raw = ev.payload.status ?? ev.payload;
    return decodeSessionStatus(raw);
  }
  return null;
}
