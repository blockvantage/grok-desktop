/**
 * List/filter audit entries (trust Phase A — task workspace + Settings).
 */

import type { AuditEntry } from "@grokdesk/shared";
import type { Db } from "../db.js";

export type AuditListParams = {
  taskId?: string | null;
  decision?: AuditEntry["decision"] | null;
  limit?: number;
};

/**
 * Clamp list limit: default 100, min 1, max 500.
 */
export function clampAuditListLimit(limit?: number): number {
  return Math.min(Math.max(1, Math.floor(limit ?? 100)), 500);
}

/**
 * List audit entries newest-first, optionally filtered by taskId / decision.
 */
export function listAuditEntries(
  db: Db,
  params: AuditListParams = {},
): AuditEntry[] {
  const limit = clampAuditListLimit(params.limit);
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (params.taskId) {
    clauses.push("task_id = ?");
    binds.push(params.taskId);
  }
  if (params.decision) {
    clauses.push("decision = ?");
    binds.push(params.decision);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, task_id, action, detail_json, decision, created_at
       FROM audit_entries ${where}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...binds, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    taskId: (r.task_id as string | null) ?? null,
    action: r.action as string,
    detail: JSON.parse(String(r.detail_json ?? "{}")) as Record<
      string,
      unknown
    >,
    decision: r.decision as AuditEntry["decision"],
    createdAt: r.created_at as string,
  }));
}
