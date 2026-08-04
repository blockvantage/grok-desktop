/**
 * Gateway-owned durable follow-up outbox (SQLite).
 *
 * id === clientMutationId. Never silently drops, evicts, or truncates rows to
 * make room — capacity returns structured `full`. Terminal receipts may be
 * pruned after retention; pending/failed/blocked rows are never auto-pruned.
 */
import { createHash } from "node:crypto";
import type {
  ConversationOutboxItem,
  OutboxEnqueueParams,
  OutboxEnqueueResult,
  OutboxStatus,
  OutboxSummary,
  TaskAttachment,
} from "@grokdesk/shared";
import {
  OutboxEnqueueParamsSchema,
  TaskAttachmentSchema,
} from "@grokdesk/shared";
import type { Db } from "../db.js";

export const OUTBOX_MAX_PENDING_PER_CONVERSATION = 200;
export const OUTBOX_MAX_PENDING_TOTAL = 2_000;
export const OUTBOX_CLAIM_LEASE_MS = 2 * 60_000;
/** Keep accepted/delivered/cancelled rows for reconciliation. */
export const OUTBOX_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const OUTBOX_PRUNE_BATCH = 100;

const ACTIVE_PENDING_STATUSES: OutboxStatus[] = [
  "pending",
  "submitting",
  "blocked_missing_attachment",
  "failed",
];

const MUTABLE_STATUSES: OutboxStatus[] = [
  "pending",
  "failed",
  "blocked_missing_attachment",
];

type OutboxRow = {
  id: string;
  conversation_id: string;
  parent_task_id: string;
  text: string;
  attachments_json: string;
  status: string;
  accepted_task_id: string | null;
  attempt_count: number;
  fail_reason: string | null;
  claim_lease_until: string | null;
  request_hash: string;
  revision_of_task_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OutboxUpdatePendingInput = {
  text?: string;
  attachments?: TaskAttachment[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function stableRequestHash(input: {
  conversationId: string;
  parentTaskId: string;
  text: string;
  attachments: TaskAttachment[];
  revisionOfTaskId?: string | null;
}): string {
  const payload = JSON.stringify({
    conversationId: input.conversationId,
    parentTaskId: input.parentTaskId,
    text: input.text,
    attachments: input.attachments,
    revisionOfTaskId: input.revisionOfTaskId ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function parseAttachments(raw: string): TaskAttachment[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((a) => {
        const r = TaskAttachmentSchema.safeParse(a);
        return r.success ? r.data : null;
      })
      .filter((a): a is TaskAttachment => a !== null);
  } catch {
    return [];
  }
}

function rowToItem(
  row: OutboxRow,
  position: number | null,
): ConversationOutboxItem {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    parentTaskId: row.parent_task_id,
    text: row.text,
    attachments: parseAttachments(row.attachments_json),
    status: row.status as OutboxStatus,
    position,
    acceptedTaskId: row.accepted_task_id,
    attemptCount: row.attempt_count,
    failReason: row.fail_reason,
    revisionOfTaskId: row.revision_of_task_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isSqliteError(err: unknown): err is { code?: string; message?: string } {
  return typeof err === "object" && err !== null;
}

export class ConversationOutboxRepository {
  constructor(private readonly db: Db) {}

  enqueue(raw: OutboxEnqueueParams): OutboxEnqueueResult {
    let params: OutboxEnqueueParams;
    try {
      params = OutboxEnqueueParamsSchema.parse(raw);
    } catch (err) {
      return {
        outcome: "persistence_failed",
        message: err instanceof Error ? err.message : "invalid outbox payload",
      };
    }

    const requestHash = stableRequestHash({
      conversationId: params.conversationId,
      parentTaskId: params.parentTaskId,
      text: params.text,
      attachments: params.attachments,
      revisionOfTaskId: params.revisionOfTaskId ?? null,
    });

    try {
      return this.db.transaction(() => {
        const existing = this.getRow(params.id);
        if (existing) {
          if (existing.request_hash === requestHash) {
            return {
              outcome: "accepted" as const,
              item: this.withPosition(existing),
            };
          }
          return {
            outcome: "persistence_failed" as const,
            message: "clientMutationId reused with different payload",
          };
        }

        const perConv = this.countActiveForConversation(params.conversationId);
        if (perConv >= OUTBOX_MAX_PENDING_PER_CONVERSATION) {
          return {
            outcome: "full" as const,
            limit: OUTBOX_MAX_PENDING_PER_CONVERSATION,
          };
        }
        const total = this.countActiveTotal();
        if (total >= OUTBOX_MAX_PENDING_TOTAL) {
          return {
            outcome: "full" as const,
            limit: OUTBOX_MAX_PENDING_TOTAL,
          };
        }

        const now = nowIso();
        this.db
          .prepare(
            `INSERT INTO conversation_outbox (
              id, conversation_id, parent_task_id, text, attachments_json,
              status, accepted_task_id, attempt_count, fail_reason,
              claim_lease_until, request_hash, revision_of_task_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, 0, NULL, NULL, ?, ?, ?, ?)`,
          )
          .run(
            params.id,
            params.conversationId,
            params.parentTaskId,
            params.text,
            JSON.stringify(params.attachments),
            requestHash,
            params.revisionOfTaskId ?? null,
            now,
            now,
          );

        const row = this.getRow(params.id);
        if (!row) {
          return {
            outcome: "persistence_failed" as const,
            message: "outbox insert did not persist",
          };
        }
        return {
          outcome: "accepted" as const,
          item: this.withPosition(row),
        };
      })();
    } catch (err) {
      const code = isSqliteError(err) ? err.code ?? "SQLITE" : "UNKNOWN";
      // Log codes/ids only — never message text or paths.
      console.error(
        JSON.stringify({
          scope: "conversation-outbox",
          event: "enqueue_failed",
          code,
          id: params.id,
          conversationId: params.conversationId,
        }),
      );
      return {
        outcome: "persistence_failed",
        message: `persistence_failed:${code}`,
      };
    }
  }

  get(id: string): ConversationOutboxItem | null {
    const row = this.getRow(id);
    if (!row) return null;
    return this.withPosition(row);
  }

  list(opts?: {
    conversationId?: string;
    includeTerminal?: boolean;
  }): ConversationOutboxItem[] {
    const includeTerminal = opts?.includeTerminal === true;
    const statuses = includeTerminal
      ? null
      : ([
          "pending",
          "submitting",
          "blocked_missing_attachment",
          "failed",
        ] as const);

    let rows: OutboxRow[];
    if (opts?.conversationId) {
      if (statuses) {
        rows = this.db
          .prepare(
            `SELECT * FROM conversation_outbox
             WHERE conversation_id = ?
               AND status IN (${statuses.map(() => "?").join(",")})
             ORDER BY created_at ASC, id ASC`,
          )
          .all(opts.conversationId, ...statuses) as OutboxRow[];
      } else {
        rows = this.db
          .prepare(
            `SELECT * FROM conversation_outbox
             WHERE conversation_id = ?
             ORDER BY created_at ASC, id ASC`,
          )
          .all(opts.conversationId) as OutboxRow[];
      }
    } else if (statuses) {
      rows = this.db
        .prepare(
          `SELECT * FROM conversation_outbox
           WHERE status IN (${statuses.map(() => "?").join(",")})
           ORDER BY created_at ASC, id ASC`,
        )
        .all(...statuses) as OutboxRow[];
    } else {
      rows = this.db
        .prepare(
          `SELECT * FROM conversation_outbox
           ORDER BY created_at ASC, id ASC`,
        )
        .all() as OutboxRow[];
    }

    return this.assignPositions(rows);
  }

  updatePending(
    id: string,
    patch: OutboxUpdatePendingInput,
  ): ConversationOutboxItem | null {
    const row = this.getRow(id);
    if (!row) return null;
    if (!MUTABLE_STATUSES.includes(row.status as OutboxStatus)) {
      throw new Error(`outbox item not editable in status ${row.status}`);
    }

    const text = patch.text ?? row.text;
    const attachments =
      patch.attachments ?? parseAttachments(row.attachments_json);
    if (!text.trim()) {
      throw new Error("outbox text required");
    }
    // Validate attachments through shared schema before write.
    const validated = attachments.map((a) => TaskAttachmentSchema.parse(a));
    const requestHash = stableRequestHash({
      conversationId: row.conversation_id,
      parentTaskId: row.parent_task_id,
      text,
      attachments: validated,
      revisionOfTaskId: row.revision_of_task_id,
    });
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE conversation_outbox
         SET text = ?, attachments_json = ?, request_hash = ?,
             status = 'pending', fail_reason = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(text, JSON.stringify(validated), requestHash, now, id);
    const next = this.getRow(id);
    return next ? this.withPosition(next) : null;
  }

  removePending(id: string): boolean {
    const row = this.getRow(id);
    if (!row) return false;
    if (
      row.status === "submitting" ||
      row.status === "accepted" ||
      row.status === "delivered"
    ) {
      throw new Error(`outbox item not removable in status ${row.status}`);
    }
    if (row.status === "cancelled") return true;
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE conversation_outbox
         SET status = 'cancelled', claim_lease_until = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, id);
    return true;
  }

  /**
   * Claim the oldest pending row for a conversation when no active claim exists.
   * Returns null when empty or already submitting.
   */
  claimNext(
    conversationId: string,
    leaseMs: number = OUTBOX_CLAIM_LEASE_MS,
  ): ConversationOutboxItem | null {
    return this.db.transaction(() => {
      const submitting = this.db
        .prepare(
          `SELECT id FROM conversation_outbox
           WHERE conversation_id = ? AND status = 'submitting'
           LIMIT 1`,
        )
        .get(conversationId) as { id: string } | undefined;
      if (submitting) return null;

      const row = this.db
        .prepare(
          `SELECT * FROM conversation_outbox
           WHERE conversation_id = ?
             AND status = 'pending'
           ORDER BY created_at ASC, id ASC
           LIMIT 1`,
        )
        .get(conversationId) as OutboxRow | undefined;
      if (!row) return null;

      const now = Date.now();
      const leaseUntil = new Date(now + leaseMs).toISOString();
      const updatedAt = new Date(now).toISOString();
      this.db
        .prepare(
          `UPDATE conversation_outbox
           SET status = 'submitting',
               claim_lease_until = ?,
               attempt_count = attempt_count + 1,
               updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(leaseUntil, updatedAt, row.id);

      const next = this.getRow(row.id);
      return next ? this.withPosition(next) : null;
    })();
  }

  markAccepted(id: string, acceptedTaskId: string): ConversationOutboxItem | null {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE conversation_outbox
         SET status = 'accepted',
             accepted_task_id = ?,
             claim_lease_until = NULL,
             fail_reason = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(acceptedTaskId, now, id);
    if (result.changes === 0) return null;
    const row = this.getRow(id);
    return row ? this.withPosition(row) : null;
  }

  markDelivered(id: string): ConversationOutboxItem | null {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE conversation_outbox
         SET status = 'delivered',
             claim_lease_until = NULL,
             fail_reason = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(now, id);
    if (result.changes === 0) return null;
    const row = this.getRow(id);
    return row ? this.withPosition(row) : null;
  }

  markFailed(id: string, reason: string): ConversationOutboxItem | null {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE conversation_outbox
         SET status = 'failed',
             fail_reason = ?,
             claim_lease_until = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(reason.slice(0, 2_000), now, id);
    if (result.changes === 0) return null;
    const row = this.getRow(id);
    return row ? this.withPosition(row) : null;
  }

  markBlockedMissingAttachment(
    id: string,
    reason = "missing_attachment",
  ): ConversationOutboxItem | null {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE conversation_outbox
         SET status = 'blocked_missing_attachment',
             fail_reason = ?,
             claim_lease_until = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(reason.slice(0, 2_000), now, id);
    if (result.changes === 0) return null;
    const row = this.getRow(id);
    return row ? this.withPosition(row) : null;
  }

  /**
   * Return a failed/blocked item to pending for drain retry.
   */
  retry(id: string): ConversationOutboxItem | null {
    const row = this.getRow(id);
    if (!row) return null;
    if (
      row.status !== "failed" &&
      row.status !== "blocked_missing_attachment"
    ) {
      throw new Error(`outbox item not retryable in status ${row.status}`);
    }
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE conversation_outbox
         SET status = 'pending',
             fail_reason = NULL,
             claim_lease_until = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(now, id);
    const next = this.getRow(id);
    return next ? this.withPosition(next) : null;
  }

  /**
   * Release expired submitting claims back to pending so drain can retry.
   */
  releaseExpiredClaims(now: Date = new Date()): number {
    const iso = now.toISOString();
    const result = this.db
      .prepare(
        `UPDATE conversation_outbox
         SET status = 'pending',
             claim_lease_until = NULL,
             updated_at = ?
         WHERE status = 'submitting'
           AND claim_lease_until IS NOT NULL
           AND claim_lease_until < ?`,
      )
      .run(iso, iso);
    return result.changes;
  }

  /**
   * Prune terminal receipt rows older than retention. Never touches
   * pending/failed/blocked/submitting.
   */
  pruneTerminalReceipts(
    olderThanMs: number = OUTBOX_TERMINAL_RETENTION_MS,
    limit: number = OUTBOX_PRUNE_BATCH,
  ): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const ids = this.db
      .prepare(
        `SELECT id FROM conversation_outbox
         WHERE status IN ('accepted', 'delivered', 'cancelled')
           AND updated_at < ?
         ORDER BY updated_at ASC
         LIMIT ?`,
      )
      .all(cutoff, limit) as Array<{ id: string }>;
    if (ids.length === 0) return 0;
    const del = this.db.prepare(
      `DELETE FROM conversation_outbox WHERE id = ?`,
    );
    let n = 0;
    const run = this.db.transaction(() => {
      for (const { id } of ids) {
        n += del.run(id).changes;
      }
    });
    run();
    return n;
  }

  /**
   * Content-free aggregate for diagnostics and Copy diagnostics.
   */
  summary(): OutboxSummary {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM conversation_outbox GROUP BY status`,
      )
      .all() as Array<{ status: string; n: number }>;
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = r.n;
      total += r.n;
    }
    const oldest = this.db
      .prepare(
        `SELECT created_at FROM conversation_outbox
         WHERE status IN ('pending', 'submitting', 'failed', 'blocked_missing_attachment')
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get() as { created_at: string } | undefined;
    let oldestPendingAgeMs: number | null = null;
    if (oldest?.created_at) {
      const t = Date.parse(oldest.created_at);
      if (Number.isFinite(t)) {
        oldestPendingAgeMs = Math.max(0, Date.now() - t);
      }
    }
    return { total, byStatus, oldestPendingAgeMs };
  }

  /**
   * Conversation IDs that have at least one drainable pending row, oldest first.
   */
  listConversationIdsWithPending(): string[] {
    const rows = this.db
      .prepare(
        `SELECT conversation_id, MIN(created_at) AS oldest
         FROM conversation_outbox
         WHERE status = 'pending'
         GROUP BY conversation_id
         ORDER BY oldest ASC`,
      )
      .all() as Array<{ conversation_id: string }>;
    return rows.map((r) => r.conversation_id);
  }

  private getRow(id: string): OutboxRow | undefined {
    return this.db
      .prepare(`SELECT * FROM conversation_outbox WHERE id = ?`)
      .get(id) as OutboxRow | undefined;
  }

  private countActiveForConversation(conversationId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM conversation_outbox
         WHERE conversation_id = ?
           AND status IN (${ACTIVE_PENDING_STATUSES.map(() => "?").join(",")})`,
      )
      .get(conversationId, ...ACTIVE_PENDING_STATUSES) as { n: number };
    return row.n;
  }

  private countActiveTotal(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM conversation_outbox
         WHERE status IN (${ACTIVE_PENDING_STATUSES.map(() => "?").join(",")})`,
      )
      .get(...ACTIVE_PENDING_STATUSES) as { n: number };
    return row.n;
  }

  private withPosition(row: OutboxRow): ConversationOutboxItem {
    if (row.status !== "pending" && row.status !== "submitting") {
      return rowToItem(row, null);
    }
    const peers = this.db
      .prepare(
        `SELECT id FROM conversation_outbox
         WHERE conversation_id = ?
           AND status IN ('pending', 'submitting')
         ORDER BY created_at ASC, id ASC`,
      )
      .all(row.conversation_id) as Array<{ id: string }>;
    const idx = peers.findIndex((p) => p.id === row.id);
    return rowToItem(row, idx >= 0 ? idx + 1 : null);
  }

  private assignPositions(rows: OutboxRow[]): ConversationOutboxItem[] {
    const pendingByConv = new Map<string, string[]>();
    for (const row of rows) {
      if (row.status === "pending" || row.status === "submitting") {
        const list = pendingByConv.get(row.conversation_id) ?? [];
        list.push(row.id);
        pendingByConv.set(row.conversation_id, list);
      }
    }
    // Positions must reflect full conversation pending order, not just listed rows.
    for (const conversationId of pendingByConv.keys()) {
      const ordered = this.db
        .prepare(
          `SELECT id FROM conversation_outbox
           WHERE conversation_id = ?
             AND status IN ('pending', 'submitting')
           ORDER BY created_at ASC, id ASC`,
        )
        .all(conversationId) as Array<{ id: string }>;
      pendingByConv.set(
        conversationId,
        ordered.map((r) => r.id),
      );
    }

    return rows.map((row) => {
      if (row.status !== "pending" && row.status !== "submitting") {
        return rowToItem(row, null);
      }
      const ordered = pendingByConv.get(row.conversation_id) ?? [];
      const idx = ordered.indexOf(row.id);
      return rowToItem(row, idx >= 0 ? idx + 1 : null);
    });
  }
}
