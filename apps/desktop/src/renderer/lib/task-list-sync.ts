/**
 * Pure task-list sync helpers for App polling / status transitions (Phase 6).
 */
import type { Task, TaskStatus } from "@grokdesk/shared";

const OPTIMISTIC_RECONCILE_MS = 120_000;

/**
 * True when a server task is the real counterpart of an optimistic placeholder
 * (same goal, same parent link, created within the reconcile window).
 * Prevents a brief double-row in the sidebar while create + poll race.
 */
export function serverReconcilesOptimistic(
  optimistic: Task,
  server: Task,
  nowMs = Date.now(),
): boolean {
  if (!optimistic.id.startsWith("optimistic-")) return false;
  if (optimistic.goal !== server.goal) return false;
  const oParent = optimistic.parentTaskId ?? null;
  const sParent = server.parentTaskId ?? null;
  if (oParent !== sParent) return false;
  const sCreated = Date.parse(server.createdAt);
  const oCreated = Date.parse(optimistic.createdAt);
  if (Number.isFinite(sCreated) && Number.isFinite(oCreated)) {
    if (Math.abs(sCreated - oCreated) > OPTIMISTIC_RECONCILE_MS) return false;
  } else if (Number.isFinite(sCreated)) {
    if (Math.abs(nowMs - sCreated) > OPTIMISTIC_RECONCILE_MS) return false;
  }
  return true;
}

/**
 * Keep not-yet-reconciled optimistic rows while replacing the rest from server.
 * Drops optimistic placeholders once the gateway list already includes the real task
 * so "kick off session" never shows two identical chats.
 */
export function mergeServerTasksWithOptimistic(
  prev: Task[],
  server: Task[],
  nowMs = Date.now(),
): Task[] {
  const optimistic = prev.filter((t) => t.id.startsWith("optimistic-"));
  if (optimistic.length === 0) return server;
  const kept = optimistic.filter(
    (o) => !server.some((s) => serverReconcilesOptimistic(o, s, nowMs)),
  );
  return kept.length ? [...kept, ...server] : server;
}

/**
 * After a task list sync, keep the open chat selected when an optimistic
 * placeholder was replaced by its real gateway id. Otherwise the workspace
 * points at a ghost id and the user has to click the sidebar again.
 */
export function remapSelectedTaskId(
  selectedId: string | null,
  prev: Task[],
  next: Task[],
  nowMs = Date.now(),
): string | null {
  if (!selectedId) return null;
  if (next.some((t) => t.id === selectedId)) return selectedId;
  if (!selectedId.startsWith("optimistic-")) return selectedId;
  const opt = prev.find((t) => t.id === selectedId);
  if (!opt) return selectedId;
  const match = next.find((s) => serverReconcilesOptimistic(opt, s, nowMs));
  return match?.id ?? selectedId;
}

export type TaskStatusMap = Map<string, TaskStatus | string>;

/**
 * Detect tasks that transitioned into a terminal finished state (done/failed)
 * since the previous status map. Used for background completion toasts.
 */
export function listNewlyFinishedTasks(
  tasks: Task[],
  prevStatuses: TaskStatusMap,
): Task[] {
  if (prevStatuses.size === 0) return [];
  const out: Task[] = [];
  for (const task of tasks) {
    const before = prevStatuses.get(task.id);
    if (!before) continue;
    if (before === "done" || before === "failed") continue;
    if (task.status === "done" || task.status === "failed") {
      out.push(task);
    }
  }
  return out;
}

/** Build a status map for the next poll comparison. */
export function buildTaskStatusMap(tasks: Task[]): TaskStatusMap {
  return new Map(tasks.map((task) => [task.id, task.status]));
}
