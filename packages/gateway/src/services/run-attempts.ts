/**
 * Durable run attempts with leases for crash recovery (Phase 2 / TASK-01).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";

export type RunAttemptStatus =
  | "queued"
  | "leased"
  | "running"
  | "waiting_approval"
  | "done"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface RunAttempt {
  id: string;
  taskId: string;
  attemptNumber: number;
  status: RunAttemptStatus;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  terminalReason: string | null;
  providerSessionId: string | null;
  capabilitySnapshotJson: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

const TERMINAL: ReadonlySet<RunAttemptStatus> = new Set([
  "done",
  "failed",
  "cancelled",
  "interrupted",
]);

export class RunAttemptService {
  constructor(
    private db: Db,
    private instanceId: string = randomUUID(),
  ) {}

  getInstanceId(): string {
    return this.instanceId;
  }

  /** Allocate the next attempt for a task (queued, unleased). */
  create(taskId: string): RunAttempt {
    const max = this.db
      .prepare(
        `SELECT COALESCE(MAX(attempt_number), 0) as m FROM task_run_attempts WHERE task_id = ?`,
      )
      .get(taskId) as { m: number };
    const attemptNumber = Number(max.m) + 1;
    const now = new Date().toISOString();
    const row: RunAttempt = {
      id: randomUUID(),
      taskId,
      attemptNumber,
      status: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      terminalReason: null,
      providerSessionId: null,
      capabilitySnapshotJson: null,
      startedAt: null,
      endedAt: null,
      createdAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO task_run_attempts (
          id, task_id, attempt_number, status, lease_owner, lease_expires_at,
          terminal_reason, provider_session_id, capability_snapshot_json,
          started_at, ended_at, created_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
      )
      .run(row.id, row.taskId, row.attemptNumber, row.status, row.createdAt);
    return row;
  }

  get(id: string): RunAttempt | null {
    const row = this.db
      .prepare(`SELECT * FROM task_run_attempts WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToAttempt(row) : null;
  }

  /**
   * Attempts for a task, oldest first. Capped so a pathological retry storm
   * cannot materialize an unbounded array into IPC/diagnostics.
   */
  listForTask(taskId: string, limit = 100): RunAttempt[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM task_run_attempts WHERE task_id = ? ORDER BY attempt_number ASC LIMIT ?`,
      )
      .all(taskId, lim) as Record<string, unknown>[];
    return rows.map(rowToAttempt);
  }

  latestForTask(taskId: string): RunAttempt | null {
    const row = this.db
      .prepare(
        `SELECT * FROM task_run_attempts WHERE task_id = ? ORDER BY attempt_number DESC LIMIT 1`,
      )
      .get(taskId) as Record<string, unknown> | undefined;
    return row ? rowToAttempt(row) : null;
  }

  /** Persist engine session id for resume on follow-up turns. */
  setProviderSessionId(attemptId: string, providerSessionId: string): void {
    this.db
      .prepare(
        `UPDATE task_run_attempts SET provider_session_id = ? WHERE id = ?`,
      )
      .run(providerSessionId, attemptId);
  }

  /** Most recent non-null provider session id for a task (any attempt). */
  latestProviderSessionId(taskId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT provider_session_id FROM task_run_attempts
         WHERE task_id = ? AND provider_session_id IS NOT NULL
         ORDER BY attempt_number DESC LIMIT 1`,
      )
      .get(taskId) as { provider_session_id: string } | undefined;
    return row?.provider_session_id ?? null;
  }

  /**
   * Store last usage snapshot for context meter (not a transcript event).
   * Side table task_run_attempt_usage (migration v10).
   */
  setLastUsage(
    attemptId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      contextWindow?: number;
    },
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO task_run_attempt_usage (attempt_id, last_usage_json)
           VALUES (?, ?)
           ON CONFLICT(attempt_id) DO UPDATE SET last_usage_json = excluded.last_usage_json`,
        )
        .run(attemptId, JSON.stringify(usage));
    } catch {
      // Table may not exist until migration; degrade silently.
    }
  }

  latestUsage(taskId: string): {
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
  } | null {
    try {
      const row = this.db
        .prepare(
          `SELECT u.last_usage_json AS last_usage_json
           FROM task_run_attempt_usage u
           JOIN task_run_attempts a ON a.id = u.attempt_id
           WHERE a.task_id = ?
           ORDER BY a.attempt_number DESC LIMIT 1`,
        )
        .get(taskId) as { last_usage_json: string } | undefined;
      if (!row?.last_usage_json) return null;
      return JSON.parse(row.last_usage_json) as {
        inputTokens: number;
        outputTokens: number;
        contextWindow?: number;
      };
    } catch {
      return null;
    }
  }

  /**
   * Claim a specific task's latest non-terminal attempt (or create none — caller creates).
   */
  claimForTask(taskId: string, leaseMs = 60_000): RunAttempt | null {
    const latest = this.latestForTask(taskId);
    if (!latest || this.isTerminal(latest.status)) return null;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expires = new Date(now + leaseMs).toISOString();
    const info = this.db
      .prepare(
        `UPDATE task_run_attempts
         SET status = CASE
               WHEN status = 'queued' THEN 'running'
               WHEN status = 'leased' THEN 'running'
               ELSE status
             END,
             lease_owner = ?,
             lease_expires_at = ?,
             started_at = COALESCE(started_at, ?)
         WHERE id = ?
           AND status NOT IN ('done','failed','cancelled','interrupted')
           AND (
             lease_owner IS NULL
             OR lease_expires_at IS NULL
             OR lease_expires_at < ?
             OR lease_owner = ?
           )`,
      )
      .run(this.instanceId, expires, nowIso, latest.id, nowIso, this.instanceId);
    if (info.changes === 0) return null;
    return this.get(latest.id);
  }

  /** Claim and publish task=running in one transaction, or roll back both. */
  claimForTaskAtomically(
    taskId: string,
    leaseMs: number,
    onClaimed: () => boolean,
  ): RunAttempt | null {
    const rejected = new Error("task_start_transition_rejected");
    try {
      return this.db.transaction(() => {
        const claimed = this.claimForTask(taskId, leaseMs);
        if (!claimed) return null;
        if (!onClaimed()) throw rejected;
        return claimed;
      })();
    } catch (error) {
      if (error === rejected) return null;
      throw error;
    }
  }

  /**
   * Claim the next queued attempt or expired lease with a fresh lease.
   * Returns null if nothing to claim.
   */
  claimNext(leaseMs = 60_000): RunAttempt | null {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expires = new Date(now + leaseMs).toISOString();

    const claimable = this.db
      .prepare(
        `SELECT * FROM task_run_attempts
         WHERE status IN ('queued', 'leased', 'running', 'waiting_approval')
           AND (
             lease_expires_at IS NULL
             OR lease_expires_at < ?
             OR (status = 'queued' AND lease_owner IS NULL)
           )
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(nowIso) as Record<string, unknown> | undefined;

    if (!claimable) return null;

    const id = String(claimable.id);
    const info = this.db
      .prepare(
        `UPDATE task_run_attempts
         SET status = CASE WHEN status = 'queued' THEN 'leased' ELSE status END,
             lease_owner = ?,
             lease_expires_at = ?,
             started_at = COALESCE(started_at, ?)
         WHERE id = ?
           AND (
             lease_owner IS NULL
             OR lease_expires_at IS NULL
             OR lease_expires_at < ?
             OR lease_owner = ?
           )`,
      )
      .run(this.instanceId, expires, nowIso, id, nowIso, this.instanceId);

    if (info.changes === 0) return null;
    return this.get(id);
  }

  heartbeat(attemptId: string, leaseMs = 60_000): boolean {
    const expires = new Date(Date.now() + leaseMs).toISOString();
    const info = this.db
      .prepare(
        `UPDATE task_run_attempts
         SET lease_expires_at = ?, status = CASE WHEN status = 'leased' THEN 'running' ELSE status END
         WHERE id = ? AND lease_owner = ? AND status NOT IN ('done','failed','cancelled','interrupted')`,
      )
      .run(expires, attemptId, this.instanceId);
    return info.changes > 0;
  }

  markWaitingApproval(attemptId: string): void {
    this.db
      .prepare(
        `UPDATE task_run_attempts SET status = 'waiting_approval' WHERE id = ? AND lease_owner = ?`,
      )
      .run(attemptId, this.instanceId);
  }

  /** Move an owned active attempt and its task state in one fenced transaction. */
  transitionOwnedAtomically(
    attemptId: string,
    expectedStatus: "running" | "waiting_approval",
    status: "running" | "waiting_approval",
    onTransitioned: () => boolean,
  ): boolean {
    const rejected = new Error("owned_attempt_transition_rejected");
    try {
      return this.db.transaction(() => {
        const info = this.db
          .prepare(
            `UPDATE task_run_attempts
             SET status = ?
             WHERE id = ? AND lease_owner = ? AND status = ?`,
          )
          .run(status, attemptId, this.instanceId, expectedStatus);
        if (info.changes === 0) return false;
        if (!onTransitioned()) throw rejected;
        return true;
      })();
    } catch (error) {
      if (error === rejected) return false;
      throw error;
    }
  }

  complete(
    attemptId: string,
    status: "done" | "failed" | "cancelled" | "interrupted",
    terminalReason: string,
  ): boolean {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `UPDATE task_run_attempts
         SET status = ?, terminal_reason = ?, ended_at = ?, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND lease_owner = ?
           AND status NOT IN ('done','failed','cancelled','interrupted')`,
      )
      .run(status, terminalReason, now, attemptId, this.instanceId);
    return info.changes > 0;
  }

  /**
   * Fence by current owner and commit dependent task state in the same SQLite
   * transaction. The callback must use services backed by this same Db.
   */
  completeOwnedAtomically(
    attemptId: string,
    status: "done" | "failed" | "cancelled" | "interrupted",
    terminalReason: string,
    onCompleted: () => void,
  ): boolean {
    return this.db.transaction(() => {
      if (!this.complete(attemptId, status, terminalReason)) return false;
      onCompleted();
      return true;
    })();
  }

  /** Fail an accepted attempt which has never been leased to a runner. */
  completeUnclaimed(
    attemptId: string,
    status: "failed" | "cancelled" | "interrupted",
    terminalReason: string,
  ): boolean {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `UPDATE task_run_attempts
         SET status = ?, terminal_reason = ?, ended_at = ?, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND lease_owner IS NULL AND status = 'queued'`,
      )
      .run(status, terminalReason, now, attemptId);
    return info.changes > 0;
  }

  /** Fence an unclaimed attempt and dependent task terminal state together. */
  completeUnclaimedAtomically(
    attemptId: string,
    status: "failed" | "cancelled" | "interrupted",
    terminalReason: string,
    onCompleted: () => void,
  ): boolean {
    return this.db.transaction(() => {
      if (!this.completeUnclaimed(attemptId, status, terminalReason)) {
        return false;
      }
      onCompleted();
      return true;
    })();
  }

  /** User cancellation revokes any owner and task state in one transaction. */
  cancelTaskAtomically(
    taskId: string,
    onCancelled: () => boolean,
  ): { cancelled: boolean; attemptId: string | null } {
    return this.db.transaction(() => {
      if (!onCancelled()) return { cancelled: false, attemptId: null };
      const latest = this.db
        .prepare(
          `SELECT id FROM task_run_attempts
           WHERE task_id = ?
             AND status NOT IN ('done','failed','cancelled','interrupted')
           ORDER BY attempt_number DESC LIMIT 1`,
        )
        .get(taskId) as { id: string } | undefined;
      if (latest) {
        const now = new Date().toISOString();
        this.db
          .prepare(
            `UPDATE task_run_attempts
             SET status = 'cancelled', terminal_reason = 'cancelled_by_user',
                 ended_at = ?, lease_owner = NULL, lease_expires_at = NULL
             WHERE id = ?
               AND status NOT IN ('done','failed','cancelled','interrupted')`,
          )
          .run(now, latest.id);
      }
      return { cancelled: true, attemptId: latest?.id ?? null };
    })();
  }

  /** Graceful shutdown may cancel only an attempt still owned by this instance. */
  cancelOwnedTaskAtomically(
    attemptId: string,
    onCancelled: () => boolean,
  ): boolean {
    const rejected = new Error("owned_cancel_transition_rejected");
    try {
      return this.db.transaction(() => {
        if (!this.complete(attemptId, "cancelled", "gateway_stopped")) {
          return false;
        }
        if (!onCancelled()) throw rejected;
        return true;
      })();
    } catch (error) {
      if (error === rejected) return false;
      throw error;
    }
  }

  /** Atomically interrupt only if the lease is still expired at write time. */
  interruptIfExpired(attemptId: string, now: Date = new Date()): boolean {
    const nowIso = now.toISOString();
    const info = this.db
      .prepare(
        `UPDATE task_run_attempts
         SET status = 'interrupted',
             terminal_reason = 'Stale lease recovered after gateway restart',
             ended_at = ?, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ?
           AND status IN ('leased','running','waiting_approval')
           AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
      )
      .run(nowIso, attemptId, nowIso);
    return info.changes > 0;
  }

  /**
   * On startup: expire foreign/stale leases → interrupted; leave queued alone.
   */
  recoverStaleLeases(now: Date = new Date()): number {
    const nowIso = now.toISOString();
    const rows = this.db
      .prepare(
        `SELECT id, status, lease_owner, lease_expires_at FROM task_run_attempts
         WHERE status IN ('leased', 'running', 'waiting_approval')`,
      )
      .all() as Array<{
      id: string;
      status: string;
      lease_owner: string | null;
      lease_expires_at: string | null;
    }>;

    let n = 0;
    for (const r of rows) {
      // The conditional update closes the select→heartbeat race: a lease
      // renewed after this snapshot is not interrupted.
      if (this.interruptIfExpired(r.id, now)) n += 1;
    }
    return n;
  }

  isTerminal(status: RunAttemptStatus): boolean {
    return TERMINAL.has(status);
  }
}

function rowToAttempt(r: Record<string, unknown>): RunAttempt {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    attemptNumber: Number(r.attempt_number),
    status: r.status as RunAttemptStatus,
    leaseOwner: (r.lease_owner as string | null) ?? null,
    leaseExpiresAt: (r.lease_expires_at as string | null) ?? null,
    terminalReason: (r.terminal_reason as string | null) ?? null,
    providerSessionId: (r.provider_session_id as string | null) ?? null,
    capabilitySnapshotJson:
      (r.capability_snapshot_json as string | null) ?? null,
    startedAt: (r.started_at as string | null) ?? null,
    endedAt: (r.ended_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}
