/**
 * Elapsed-time helpers for live progress (PROG-1).
 * Format is m:ss with no hour rollover (3600s → "60:00").
 */

/** Format whole seconds as `m:ss` (tabular-friendly). */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

/**
 * Whole seconds between an ISO start and a wall-clock ms.
 * Invalid / future starts return 0.
 */
export function elapsedSince(startIso: string, nowMs: number): number {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
}

/**
 * Best available start ISO for a live task timer.
 *
 * Constraint: packages/shared Task has createdAt / updatedAt / completedAt only —
 * current-attempt `startedAt` is not exposed on the task payload. `createdAt` is
 * the run birth time for this task row (including follow-up turns). `updatedAt`
 * moves on every event write, so it is a worse approximation for elapsed.
 */
export function taskElapsedStartIso(task: {
  createdAt?: string | null;
  updatedAt?: string | null;
}): string | null {
  const created = task.createdAt?.trim();
  if (created && !Number.isNaN(Date.parse(created))) return created;
  const updated = task.updatedAt?.trim();
  if (updated && !Number.isNaN(Date.parse(updated))) return updated;
  return null;
}
