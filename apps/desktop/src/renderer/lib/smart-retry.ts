/**
 * Smart retry — rebuild a follow-up goal that preserves intent + failure context.
 */

export type RetryContext = {
  originalGoal: string;
  failureMessage?: string | null;
  /** Last assistant partial, if any. */
  partialAnswer?: string | null;
  /** Attempt number (1 = first retry). */
  attempt?: number;
};

/**
 * Build a retry prompt the model can act on without losing context.
 */
export function buildSmartRetryGoal(ctx: RetryContext): string {
  const goal = ctx.originalGoal.trim();
  if (!goal) return "Please retry the previous task.";

  const attempt = ctx.attempt && ctx.attempt > 1 ? ctx.attempt : 1;
  const parts: string[] = [
    `Retry the following task (attempt ${attempt}).`,
    "",
    "## Original goal",
    goal,
  ];

  const fail = ctx.failureMessage?.trim();
  if (fail) {
    parts.push("", "## What went wrong", fail.slice(0, 1200));
  }

  const partial = ctx.partialAnswer?.trim();
  if (partial) {
    parts.push(
      "",
      "## Partial progress so far",
      partial.slice(0, 2000),
      "",
      "Continue from what already worked; do not redo completed steps unless necessary.",
    );
  } else {
    parts.push(
      "",
      "Pick up cleanly: diagnose the failure, fix the root cause, and finish the original goal.",
    );
  }

  return parts.join("\n");
}

/**
 * Whether a status should offer smart retry (vs plain follow-up).
 */
export function shouldOfferSmartRetry(status: string): boolean {
  const s = status.toLowerCase();
  return s === "failed" || s === "cancelled" || s === "canceled" || s === "interrupted";
}

/**
 * Extract a short failure line from task events or error fields.
 */
export function extractFailureMessage(input: {
  errorMessage?: string | null;
  lastEventMessage?: string | null;
  status?: string | null;
}): string | null {
  const err = input.errorMessage?.trim();
  if (err) return err;
  const ev = input.lastEventMessage?.trim();
  if (ev) return ev;
  if (input.status === "failed") return "The run failed without a detailed error.";
  if (input.status === "cancelled" || input.status === "canceled") {
    return "The run was stopped before completion.";
  }
  if (input.status === "interrupted") {
    return "The run was interrupted (app or gateway restart).";
  }
  return null;
}
