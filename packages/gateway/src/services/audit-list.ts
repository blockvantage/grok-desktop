/**
 * List/filter audit entries (trust Phase A — task workspace + Settings).
 *
 * Honesty:
 * - Returns { entries, hasMore, total, limit } so truncation is never silent.
 * - Isolates corrupt detail_json per row (does not fail the whole list).
 * - Validates decision enum; unknown DB values become "info" + _unknownDecision.
 * - Redacts secret-like detail keys/values before IPC (mirrors operation-receipts).
 */

import type { AuditEntry } from "@grokdesk/shared";
import type { Db } from "../db.js";

export const AUDIT_DECISIONS = [
  "allow",
  "deny",
  "approve",
  "reject",
  "info",
] as const satisfies readonly AuditEntry["decision"][];

const AUDIT_DECISION_SET = new Set<string>(AUDIT_DECISIONS);

export type AuditListParams = {
  taskId?: string | null;
  decision?: AuditEntry["decision"] | null;
  limit?: number;
};

/** Honest list result — consumers must not treat a page as the full trail. */
export type AuditListResult = {
  entries: AuditEntry[];
  /** True when more matching rows exist beyond this page. */
  hasMore: boolean;
  /** Total matching rows under the same filters (not clamped to limit). */
  total: number;
  /** Effective limit applied after clamp (default 100, max 500). */
  limit: number;
};

/**
 * Clamp list limit: default 100, min 1, max 500.
 * Non-finite values (NaN, ±Infinity) fall back to the default.
 */
export function clampAuditListLimit(limit?: number): number {
  const raw =
    typeof limit === "number" && Number.isFinite(limit) ? limit : 100;
  return Math.min(Math.max(1, Math.floor(raw)), 500);
}

/**
 * Build decision WHERE clause aligned with parseAuditDecision mapping.
 *
 * Stored corrupt/unknown decision strings are presented as "info" on read.
 * Filtering decision:"info" must therefore include those rows (not only the
 * literal column value "info"), or filter results disagree with AuditEntry.decision.
 * Known non-info decisions match the column exactly.
 */
function pushDecisionFilter(
  decision: AuditEntry["decision"],
  clauses: string[],
  binds: unknown[],
): void {
  if (decision === "info") {
    // Present-as-info: literal "info" OR any value outside the known enum set.
    const placeholders = AUDIT_DECISIONS.map(() => "?").join(", ");
    clauses.push(
      `(decision = ? OR decision NOT IN (${placeholders}) OR decision IS NULL OR decision = '')`,
    );
    binds.push("info", ...AUDIT_DECISIONS);
    return;
  }
  clauses.push("decision = ?");
  binds.push(decision);
}

/**
 * List audit entries newest-first, optionally filtered by taskId / decision.
 */
export function listAuditEntries(
  db: Db,
  params: AuditListParams = {},
): AuditListResult {
  const limit = clampAuditListLimit(params.limit);
  const clauses: string[] = [];
  const binds: unknown[] = [];
  // null / empty string / undefined all mean "omit filter" (not IS NULL).
  if (params.taskId) {
    clauses.push("task_id = ?");
    binds.push(params.taskId);
  }
  if (params.decision) {
    pushDecisionFilter(params.decision, clauses, binds);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM audit_entries ${where}`)
    .get(...binds) as { c: number } | undefined;
  const total = Number(totalRow?.c ?? 0);

  // Secondary id DESC matches tasks.list: same-ms ISO timestamps stay stable.
  const rows = db
    .prepare(
      `SELECT id, task_id, action, detail_json, decision, created_at
       FROM audit_entries ${where}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...binds, limit) as Record<string, unknown>[];

  const entries = rows.map((r) => mapAuditRow(r));
  return {
    entries,
    hasMore: total > entries.length,
    total,
    limit,
  };
}

function mapAuditRow(r: Record<string, unknown>): AuditEntry {
  const rawDecision = r.decision;
  const decision = parseAuditDecision(rawDecision);
  let detail = parseAuditDetail(r.detail_json);
  if (
    typeof rawDecision === "string" &&
    rawDecision &&
    !AUDIT_DECISION_SET.has(rawDecision)
  ) {
    detail = { ...detail, _unknownDecision: rawDecision };
  }
  return {
    id: r.id as string,
    taskId: (r.task_id as string | null) ?? null,
    action: r.action as string,
    detail: redactAuditDetail(detail),
    decision,
    createdAt: r.created_at as string,
  };
}

/**
 * Known mediation outcomes only. Corrupt / unexpected DB strings are not
 * promoted to typed allow/deny/approve/reject truth.
 */
export function parseAuditDecision(raw: unknown): AuditEntry["decision"] {
  const s = String(raw ?? "");
  if (AUDIT_DECISION_SET.has(s)) {
    return s as AuditEntry["decision"];
  }
  return "info";
}

/**
 * Fail-soft detail parse: one corrupt row must not hide the rest of the audit trail.
 * Mirrors operation-receipts `_corruptDetail` handling.
 */
function parseAuditDetail(raw: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw ?? "{}")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { _corruptDetail: true };
  } catch {
    return { _corruptDetail: true };
  }
}

/**
 * Redact secret-like keys and inline password/token assignments for Settings /
 * task inspection surfaces. Mirrors operation-receipts.redactDetail policy.
 */
export function redactAuditDetail(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (/secret|token|password|api[_-]?key|authorization|credential/i.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "string") {
      let s = v.replace(
        /(password|token|api[_-]?key|secret|authorization)\s*[:=]\s*\S+/gi,
        "$1=[REDACTED]",
      );
      if (s.length > 2_000) {
        s = s.slice(0, 2_000) + "…[truncated]";
      }
      out[k] = s;
      continue;
    }
    out[k] = v;
  }
  return out;
}
