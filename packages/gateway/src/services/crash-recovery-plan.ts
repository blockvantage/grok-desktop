/**
 * Pure crash-recovery decisions (Phase 2 residual).
 * Wired by recoverInterruptedTasks — no I/O here.
 */

/** Task statuses that cannot safely resume after gateway death without provider resume. */
export function shouldInterruptTaskStatus(status: string): boolean {
  return status === "running" || status === "waiting_approval";
}

export type InterruptPlan =
  | { kind: "skip" }
  | {
      kind: "resume";
      requeueStatus: "queued";
    }
  | {
      kind: "interrupt";
      terminalStatus: "failed";
      eventCode: "interrupted_on_restart";
      eventMessage: string;
      attemptTerminal: "interrupted";
      attemptReason: "gateway_restart";
    };

/**
 * Plan recovery action for a single persisted task row after unclean restart.
 * Prefer resume when a provider session id exists; otherwise interrupt.
 */
export function planTaskInterruptOnRestart(
  status: string,
  opts?: { providerSessionId?: string | null },
): InterruptPlan {
  if (!shouldInterruptTaskStatus(status)) {
    return { kind: "skip" };
  }
  if (status === "running" && opts?.providerSessionId) {
    return { kind: "resume", requeueStatus: "queued" };
  }
  return {
    kind: "interrupt",
    terminalStatus: "failed",
    eventCode: "interrupted_on_restart",
    eventMessage:
      "Interrupted by gateway restart — run attempt lease recovered; retry manually.",
    attemptTerminal: "interrupted",
    attemptReason: "gateway_restart",
  };
}

/**
 * Whether an open run-attempt lease should be completed during interrupt recovery.
 */
export function shouldCompleteOpenAttempt(input: {
  hasLatest: boolean;
  isTerminal: boolean;
}): boolean {
  return input.hasLatest && !input.isTerminal;
}
