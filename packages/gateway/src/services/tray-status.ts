/**
 * Pure tray status derivation from task list (Phase 6 extract).
 */
import type { Task, TrayStatus } from "@grokdesk/shared";

export function computeTrayStatus(
  tasks: readonly Task[],
  paused: boolean,
): { status: TrayStatus; runningCount: number } {
  if (paused) {
    return { status: "paused", runningCount: 0 };
  }
  const running = tasks.filter((t) => t.status === "running").length;
  const needs = tasks.some(
    (t) => t.status === "waiting_approval" || t.status === "waiting_user",
  );
  if (needs) return { status: "needs_you", runningCount: running };
  if (running > 0) return { status: "working", runningCount: running };
  return { status: "idle", runningCount: running };
}
