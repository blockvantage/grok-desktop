/**
 * Gateway restart recovery for ambiguous in-flight tasks (TASK-01).
 * Extracted from Gateway for Phase 6 modularity — pure domain logic.
 */
import type { TaskService } from "./tasks.js";
import type { RunAttemptService } from "./run-attempts.js";
import { planTaskInterruptOnRestart } from "./crash-recovery-plan.js";

export interface CrashRecoveryDeps {
  tasks: TaskService;
  runAttempts: RunAttemptService;
  /** Pump durable queued work after recovery. */
  pumpQueue: () => Promise<void>;
  now?: () => Date;
}

/**
 * Mark running / waiting_approval as failed (interrupted), complete open
 * run-attempt leases, recover stale leases, and re-pump the queue.
 */
export function recoverInterruptedTasks(deps: CrashRecoveryDeps): {
  interruptedTaskIds: string[];
  recoveredLeases: number;
} {
  const nowDate = (deps.now ?? (() => new Date))();
  const now = nowDate.toISOString();
  const interruptedTaskIds: string[] = [];
  let recoveredLeases = 0;

  try {
    recoveredLeases = deps.runAttempts.recoverStaleLeases(
      nowDate,
    );
  } catch {
    recoveredLeases = 0;
  }

  try {
    for (const t of deps.tasks.list()) {
      const plan = planTaskInterruptOnRestart(t.status);
      if (plan.kind !== "interrupt") continue;
      const latest = deps.runAttempts.latestForTask(t.id);
      if (latest && !deps.runAttempts.isTerminal(latest.status)) {
        // Atomic expiry predicate is authoritative. If it loses, another live
        // owner renewed/claimed the attempt and this gateway must not touch
        // either the task status or attempt.
        if (!deps.runAttempts.interruptIfExpired(latest.id, nowDate)) continue;
      } else if (latest && latest.status !== "interrupted") {
        // Heal the legacy/crash boundary where attempt completion committed
        // but the matching task terminal status did not.
        const terminalStatus = latest.status === "done"
          ? "done"
          : latest.status === "cancelled"
            ? "cancelled"
            : "failed";
        deps.tasks.setStatus(t.id, terminalStatus);
        continue;
      }
      deps.tasks.setStatus(t.id, plan.terminalStatus);
      deps.tasks.appendEvent(t.id, "error", {
        message: plan.eventMessage,
        code: plan.eventCode,
        at: now,
      });
      interruptedTaskIds.push(t.id);
    }
  } catch {
    // best-effort
  }

  void deps.pumpQueue().catch(() => {});
  return { interruptedTaskIds, recoveredLeases };
}
