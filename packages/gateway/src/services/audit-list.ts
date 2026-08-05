/**
 * List/filter audit entries (trust Phase A — task workspace + Settings).
 *
 * Honesty:
 * - Returns { entries, hasMore, total, limit, offset } so truncation is never silent.
 * - Offset pagination lets consumers load older rows past the first page (limit max 500).
 * - Newest-first order is stable under timestamp ties (`ORDER BY created_at DESC, id DESC`).
 * - Isolates corrupt detail_json per row (does not fail the whole list).
 * - Validates decision enum; unknown/empty/null DB values become "info" + _unknownDecision.
 * - decision:"info" filter includes remapped/unknown stored decisions (matches display).
 * - Deep-redacts secret-like + commerce field names (privateKey, productKey, lease, …)
 *   and shared secret value patterns before IPC.
 */

import {
  COMMERCE_SECRET_FIELD_NAMES,
  looksLikeSecretEnvKey,
  redactSecretString,
  type AuditEntry,
} from "@grokdesk/shared";
import type { Db } from "../db.js";

export const AUDIT_DECISIONS = [
  "allow",
  "deny",
  "approve",
  "reject",
  "info",
] as const satisfies readonly AuditEntry["decision"][];

const AUDIT_DECISION_SET = new Set<string>(AUDIT_DECISIONS);

/** Known mediation outcomes stored as-is (not remapped to info). */
const KNOWN_DECISION_SQL = "('allow','deny','approve','reject','info')";

/**
 * Reserved provenance keys — stripped from stored detail so writers cannot
 * spoof integrity markers. Only the list path may re-attach them.
 */
export const AUDIT_PROVENANCE_KEYS = [
  "_unknownDecision",
  "_corruptDetail",
] as const;

/** Generic secret-like key fragments (case-insensitive substring). */
const SECRET_KEY_RE =
  /secret|token|password|passwd|api[_-]?key|authorization|credential|private[_-]?key|product[_-]?key|grant|lease|nonce/i;

const ASSIGNMENT_SECRET_RE =
  /(password|passwd|token|api[_-]?key|secret|authorization|private[_-]?key|product[_-]?key|grant|lease|nonce|sig|auth)\s*[:=]\s*\S+/gi;

/** Lowercased commerce field names for exact key redaction. */
const COMMERCE_FIELD_LOWER = new Set(
  (COMMERCE_SECRET_FIELD_NAMES as readonly string[]).map((f) => f.toLowerCase()),
);

/** Max depth when walking nested audit detail (tool_request trees, etc.). */
const REDACT_MAX_DEPTH = 24;

/**
 * Distinct from secret `[REDACTED]` so operators can tell truncated structure
 * from scrubbed secrets.
 */
export const AUDIT_DEPTH_TRUNCATED = "[…depth-truncated]";

/** Max string length returned in listed detail (IPC size bound). */
export const AUDIT_DETAIL_STRING_MAX = 2_000;

export type AuditListParams = {
  taskId?: string | null;
  decision?: AuditEntry["decision"] | null;
  limit?: number;
  /** Skip this many newest-first rows (default 0). */
  offset?: number;
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
  /** Effective offset applied after clamp (default 0). */
  offset: number;
};

/**
 * Clamp list limit: default 100, min 1, max 500.
 * Non-finite / non-number inputs fail closed to the default (not NaN LIMIT).
 */
export function clampAuditListLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 100;
  }
  return Math.min(Math.max(1, Math.floor(limit)), 500);
}

/**
 * Clamp list offset: default 0, min 0.
 * Non-finite / non-number inputs fail closed to 0.
 */
export function clampAuditListOffset(offset?: number): number {
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.floor(offset));
}

/**
 * List audit entries newest-first, optionally filtered by taskId / decision.
 * Use offset + limit to page beyond the first 500 rows.
 */
export function listAuditEntries(
  db: Db,
  params: AuditListParams = {},
): AuditListResult {
  const limit = clampAuditListLimit(params.limit);
  const offset = clampAuditListOffset(params.offset);
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (params.taskId) {
    clauses.push("task_id = ?");
    binds.push(params.taskId);
  }
  if (params.decision) {
    appendDecisionFilter(params.decision, clauses, binds);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM audit_entries ${where}`)
    .get(...binds) as { c: number } | undefined;
  const total = Number(totalRow?.c ?? 0);

  // Secondary id DESC keeps OFFSET pages stable when created_at ties
  // (same pattern as tasks.list newest-first).
  const rows = db
    .prepare(
      `SELECT id, task_id, action, detail_json, decision, created_at
       FROM audit_entries ${where}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...binds, limit, offset) as Record<string, unknown>[];

  const entries = rows.map((r) => mapAuditRow(r));
  return {
    entries,
    hasMore: total > offset + entries.length,
    total,
    limit,
    offset,
  };
}

/**
 * decision:"info" must include rows whose stored decision is unknown/corrupt
 * (parseAuditDecision remaps those to "info" for display). Other filters use
 * exact stored values.
 */
function appendDecisionFilter(
  decision: AuditEntry["decision"],
  clauses: string[],
  binds: unknown[],
): void {
  if (decision === "info") {
    // Stored "info" OR anything parseAuditDecision would remap to info.
    clauses.push(
      `(decision = 'info' OR decision IS NULL OR decision = '' OR decision NOT IN ${KNOWN_DECISION_SQL})`,
    );
    return;
  }
  clauses.push("decision = ?");
  binds.push(decision);
}

function mapAuditRow(r: Record<string, unknown>): AuditEntry {
  const rawDecision = r.decision;
  const decision = parseAuditDecision(rawDecision);
  // parseAuditDetail returns either clean object (stripped of spoofed
  // provenance) or a fresh {_corruptDetail:true} from parse failure only.
  let detail = parseAuditDetail(r.detail_json);
  const unknownMarker = unknownDecisionMarker(rawDecision);
  if (unknownMarker !== null) {
    // Authoritative provenance — never trust stored detail for this key.
    detail = { ...detail, _unknownDecision: unknownMarker };
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

/** Drop spoofable provenance keys from writer-controlled JSON. */
export function stripSpoofedProvenance(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...detail };
  for (const k of AUDIT_PROVENANCE_KEYS) {
    delete out[k];
  }
  return out;
}

/**
 * Marker for any stored decision that is not a known mediation enum value.
 * Returns null when the raw value is already a known decision.
 */
export function unknownDecisionMarker(raw: unknown): string | null {
  if (typeof raw === "string" && AUDIT_DECISION_SET.has(raw)) {
    return null;
  }
  if (typeof raw === "string") {
    return raw === "" ? "_empty" : raw;
  }
  if (raw === null || raw === undefined) {
    return "_null";
  }
  return `_type:${typeof raw}`;
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
 * Spoofed provenance keys in stored JSON are stripped; only we set them.
 */
function parseAuditDetail(raw: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw ?? "{}")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return stripSpoofedProvenance(parsed as Record<string, unknown>);
    }
    return { _corruptDetail: true };
  } catch {
    return { _corruptDetail: true };
  }
}

/**
 * Deep-redact secret-like keys and values for Settings / task inspection.
 * Aligns with shared looksLikeSecretEnvKey + commerce field names + value patterns.
 */
export function redactAuditDetail(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  return redactAuditValue(detail, 0) as Record<string, unknown>;
}

/** True when a detail key must be fully redacted (never wire the value). */
export function isAuditSecretKey(key: string): boolean {
  if (looksLikeSecretEnvKey(key)) return true;
  if (SECRET_KEY_RE.test(key)) return true;
  const lower = key.toLowerCase();
  // JWK private parameter `d` (same rule as shared isCommerceSecretFieldName).
  if (lower === "d") return true;
  return COMMERCE_FIELD_LOWER.has(lower);
}

function redactAuditValue(value: unknown, depth: number): unknown {
  if (value == null) return value;
  if (depth > REDACT_MAX_DEPTH) return AUDIT_DEPTH_TRUNCATED;
  if (typeof value === "string") {
    return redactAuditString(value);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactAuditValue(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isAuditSecretKey(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = redactAuditValue(v, depth + 1);
  }
  return out;
}

function redactAuditString(input: string): string {
  // Assignment forms first so "token=abc" becomes "token=[REDACTED]" before
  // pattern redaction, preserving key names for operators.
  let s = input.replace(ASSIGNMENT_SECRET_RE, "$1=[REDACTED]");
  s = redactSecretString(s);
  if (s.length > AUDIT_DETAIL_STRING_MAX) {
    s = s.slice(0, AUDIT_DETAIL_STRING_MAX) + "…[truncated]";
  }
  return s;
}
