/**
 * Structured operation receipts for policy decisions and effects (AUDIT-01 / Phase 2).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";

export type OperationDecision = "allow" | "deny" | "ask" | "info" | "error";

export interface OperationReceipt {
  id: string;
  taskId: string | null;
  runAttemptId: string | null;
  principalId: string | null;
  action: string;
  decision: OperationDecision;
  effect: string | null;
  detail: Record<string, unknown>;
  redactionClass: string;
  correlationId: string | null;
  createdAt: string;
}

export class OperationReceiptService {
  constructor(private db: Db) {}

  append(input: {
    taskId?: string | null;
    runAttemptId?: string | null;
    principalId?: string | null;
    action: string;
    decision: OperationDecision;
    effect?: string | null;
    detail?: Record<string, unknown>;
    redactionClass?: string;
    correlationId?: string | null;
  }): OperationReceipt {
    const full: OperationReceipt = {
      id: randomUUID(),
      taskId: input.taskId ?? null,
      runAttemptId: input.runAttemptId ?? null,
      principalId: input.principalId ?? null,
      action: input.action,
      decision: input.decision,
      effect: input.effect ?? null,
      detail: redactDetail(input.detail ?? {}),
      redactionClass: input.redactionClass ?? "standard",
      correlationId: input.correlationId ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO operation_receipts (
          id, task_id, run_attempt_id, principal_id, action, decision,
          effect, detail_json, redaction_class, correlation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.id,
        full.taskId,
        full.runAttemptId,
        full.principalId,
        full.action,
        full.decision,
        full.effect,
        JSON.stringify(full.detail),
        full.redactionClass,
        full.correlationId,
        full.createdAt,
      );
    return full;
  }

  listForTask(taskId: string, limit = 200): OperationReceipt[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM operation_receipts WHERE task_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(taskId, limit) as Record<string, unknown>[];
    return rows.map(rowToReceipt);
  }
}

function redactDetail(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (/secret|token|password|api[_-]?key|authorization|credential/i.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "string") {
      // Scrub inline secret-like assignments in command/output snippets.
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

function rowToReceipt(r: Record<string, unknown>): OperationReceipt {
  let detail: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(r.detail_json || "{}")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      detail = parsed as Record<string, unknown>;
    } else {
      detail = { _corruptDetail: true };
    }
  } catch {
    detail = { _corruptDetail: true };
  }
  return {
    id: String(r.id),
    taskId: (r.task_id as string | null) ?? null,
    runAttemptId: (r.run_attempt_id as string | null) ?? null,
    principalId: (r.principal_id as string | null) ?? null,
    action: String(r.action),
    decision: r.decision as OperationDecision,
    effect: (r.effect as string | null) ?? null,
    detail,
    redactionClass: String(r.redaction_class ?? "standard"),
    correlationId: (r.correlation_id as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}
