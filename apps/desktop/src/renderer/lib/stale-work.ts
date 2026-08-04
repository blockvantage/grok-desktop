/**
 * Stale work detection — surface tasks that look stuck so users can retry or stop.
 * Failed piles are NOT listed here; Home collapses those into one summary.
 */

export type StaleTaskInput = {
  id: string;
  title?: string | null;
  goal: string;
  status: string;
  updatedAt: string;
};

export type StaleTask = {
  taskId: string;
  title: string;
  status: string;
  staleForMs: number;
  reason: "no_progress" | "waiting_too_long";
};

const ACTIVE = new Set(["running", "starting", "streaming"]);
const WAITING = new Set(["waiting_approval", "waiting_user"]);

/**
 * Flag stuck running / waiting tasks (not failed graveyards).
 */
export function detectStaleWork(
  tasks: StaleTaskInput[],
  now: Date,
  opts?: {
    activeStaleMs?: number;
    waitingStaleMs?: number;
  },
): StaleTask[] {
  const activeStaleMs = opts?.activeStaleMs ?? 30 * 60_000;
  const waitingStaleMs = opts?.waitingStaleMs ?? 2 * 60 * 60_000;
  const nowMs = now.getTime();
  const out: StaleTask[] = [];

  for (const t of tasks) {
    const updated = Date.parse(t.updatedAt);
    if (!Number.isFinite(updated)) continue;
    const age = nowMs - updated;
    if (age < 0) continue;
    const title = (t.title?.trim() || t.goal.slice(0, 64) || "Task").trim();
    const status = t.status.toLowerCase();

    if (ACTIVE.has(status) && age >= activeStaleMs) {
      out.push({
        taskId: t.id,
        title,
        status: t.status,
        staleForMs: age,
        reason: "no_progress",
      });
    } else if (WAITING.has(status) && age >= waitingStaleMs) {
      out.push({
        taskId: t.id,
        title,
        status: t.status,
        staleForMs: age,
        reason: "waiting_too_long",
      });
    }
  }

  return out.sort((a, b) => b.staleForMs - a.staleForMs);
}

export function formatStaleDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function staleHeadline(items: StaleTask[]): string | null {
  if (items.length === 0) return null;
  if (items.length === 1) {
    const s = items[0]!;
    if (s.reason === "waiting_too_long") return "1 task still needs you";
    return "1 task looks stuck";
  }
  return `${items.length} tasks may need attention`;
}
