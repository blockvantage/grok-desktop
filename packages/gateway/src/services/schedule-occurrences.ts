/**
 * Durable schedule occurrences with unique (scheduleId, scheduledFor).
 *
 * A failed occurrence may be reclaimed for a bounded number of submit
 * attempts so transient task-creation errors do not permanently skip a run.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";

export type OccurrenceStatus =
  | "pending"
  | "fired"
  | "skipped"
  | "failed"
  | "misfired";

/** Max submit attempts per (scheduleId, scheduledFor), including the first. */
export const MAX_SCHEDULE_OCCURRENCE_ATTEMPTS = 3;

export interface ScheduleOccurrence {
  id: string;
  scheduleId: string;
  scheduledFor: string;
  status: OccurrenceStatus;
  taskId: string | null;
  error: string | null;
  /** Number of submit attempts started for this occurrence (1 on first begin). */
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export class ScheduleOccurrenceService {
  constructor(private db: Db) {}

  /**
   * Claim an occurrence for dispatch.
   *
   * - Inserts a new row (status pending, attempt_count 1) when none exists.
   * - Reclaims an existing row only when status is 'failed' and
   *   attempt_count < MAX_SCHEDULE_OCCURRENCE_ATTEMPTS (atomic UPDATE).
   * - Returns null for fired / pending / exhausted-failed / other terminal
   *   rows so a successful fire is never double-dispatched and permanent
   *   failures do not loop forever.
   */
  tryBegin(
    scheduleId: string,
    scheduledFor: Date | string,
  ): ScheduleOccurrence | null {
    const scheduledForIso =
      typeof scheduledFor === "string"
        ? scheduledFor
        : scheduledFor.toISOString();
    const now = new Date().toISOString();
    const id = randomUUID();
    try {
      this.db
        .prepare(
          `INSERT INTO schedule_occurrences (
            id, schedule_id, scheduled_for, status, task_id, error,
            attempt_count, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', NULL, NULL, 1, ?, ?)`,
        )
        .run(id, scheduleId, scheduledForIso, now, now);
      return this.get(id)!;
    } catch {
      // Unique (schedule_id, scheduled_for): reclaim only bounded failures.
      const result = this.db
        .prepare(
          `UPDATE schedule_occurrences
           SET status = 'pending',
               error = NULL,
               attempt_count = attempt_count + 1,
               updated_at = ?
           WHERE schedule_id = ?
             AND scheduled_for = ?
             AND status = 'failed'
             AND attempt_count < ?`,
        )
        .run(
          now,
          scheduleId,
          scheduledForIso,
          MAX_SCHEDULE_OCCURRENCE_ATTEMPTS,
        );
      if (result.changes === 0) return null;
      return this.find(scheduleId, scheduledForIso);
    }
  }

  get(id: string): ScheduleOccurrence | null {
    const row = this.db
      .prepare(`SELECT * FROM schedule_occurrences WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToOcc(row) : null;
  }

  find(scheduleId: string, scheduledFor: string): ScheduleOccurrence | null {
    const row = this.db
      .prepare(
        `SELECT * FROM schedule_occurrences WHERE schedule_id = ? AND scheduled_for = ?`,
      )
      .get(scheduleId, scheduledFor) as Record<string, unknown> | undefined;
    return row ? rowToOcc(row) : null;
  }

  markFired(id: string, taskId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE schedule_occurrences SET status = 'fired', task_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(taskId, now, id);
  }

  markFailed(id: string, error: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE schedule_occurrences SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(error, now, id);
  }

  listForSchedule(scheduleId: string, limit = 200): ScheduleOccurrence[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 1_000);
    const rows = this.db
      .prepare(
        `SELECT * FROM schedule_occurrences WHERE schedule_id = ? ORDER BY scheduled_for DESC LIMIT ?`,
      )
      .all(scheduleId, lim) as Record<string, unknown>[];
    return rows.map(rowToOcc);
  }

  /** Drop terminal occurrence history older than maxAgeDays. */
  prune(maxAgeDays = 90): number {
    const cutoff = new Date(
      Date.now() - maxAgeDays * 24 * 3600_000,
    ).toISOString();
    const r = this.db
      .prepare(
        `DELETE FROM schedule_occurrences
         WHERE scheduled_for < ?
           AND status IN ('fired', 'skipped', 'failed', 'misfired')`,
      )
      .run(cutoff);
    return r.changes ?? 0;
  }
}

function rowToOcc(r: Record<string, unknown>): ScheduleOccurrence {
  return {
    id: String(r.id),
    scheduleId: String(r.schedule_id),
    scheduledFor: String(r.scheduled_for),
    status: r.status as OccurrenceStatus,
    taskId: (r.task_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    attemptCount: Number(r.attempt_count ?? 0),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
