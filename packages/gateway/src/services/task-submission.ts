/**
 * Single entry path for interactive, remote, scheduled, retry, and automation work.
 * Allocates a durable run attempt after the task row is committed.
 *
 * Grok admission: when an EntitlementGuard is injected, submit refuses with
 * EntitlementReadOnlyError before any durable side effects. Prefer DI over a
 * global singleton so tests can pass fakes. Sync assert requires a prior
 * refresh() (or production wiring that keeps the snapshot warm).
 */
import type { CreateTaskInput, Task } from "@grokdesk/shared";
import {
  newRequestCorrelation,
  withRunAttempt,
  withTask,
  type CorrelationChain,
} from "@grokdesk/shared";
import type { TaskService } from "./tasks.js";
import type { RunAttemptService, RunAttempt } from "./run-attempts.js";
import type { RequestContext } from "./request-context.js";
import { desktopRequestContext } from "./request-context.js";
import type { EntitlementGuard } from "./entitlement-guard.js";
import { requireGrokAdmissionSync } from "./entitlement-admission.js";

export interface SubmitTaskResult {
  task: Task;
  runAttempt: RunAttempt;
  principalId: string;
  /** Bounded correlation chain for observability (request → task → attempt). */
  correlation: CorrelationChain;
}

export type SubmitTaskOptions = {
  deferTaskHooks?: boolean;
  /**
   * Override the admission action string (e.g. `"retry"`).
   * When omitted, derived from transport / parent / revision / mode.
   */
  action?: string;
};

/**
 * Map create input + request context to a stable admission action label
 * used by the entitlement entrypoint matrix.
 */
export function grokAdmissionActionFor(
  input: CreateTaskInput,
  ctx?: RequestContext,
  opts?: { action?: string },
): string {
  if (opts?.action) return opts.action;
  if (ctx?.transport === "remote") return "remote";
  if (input.revisionOfTaskId) return "revision";
  if (input.parentTaskId) return "follow_up";
  if (input.mode === "scheduled") return "scheduled";
  return "interactive";
}

export class TaskSubmissionService {
  constructor(
    private tasks: TaskService,
    private runAttempts: RunAttemptService,
    private entitlementGuard: EntitlementGuard | null = null,
  ) {}

  /** Inject or clear the shared entitlement guard (composition root / tests). */
  setEntitlementGuard(guard: EntitlementGuard | null): void {
    this.entitlementGuard = guard;
  }

  submit(
    input: CreateTaskInput,
    ctx?: RequestContext,
    opts?: SubmitTaskOptions,
  ): SubmitTaskResult {
    const requestCtx = ctx ?? desktopRequestContext(`submit-${Date.now()}`);

    // Production fail-closed: null guard still denies when FAIL_CLOSED=1.
    // Tests leave FAIL_CLOSED off so unguarded composition remains open.
    {
      const action = grokAdmissionActionFor(input, requestCtx, opts);
      requireGrokAdmissionSync(this.entitlementGuard, action);
    }

    const principalId =
      requestCtx.principalDeviceId ??
      (requestCtx.transport === "desktop" ? "desktop" : "unknown");

    const task = this.tasks.create(input, {
      emitHooks: !opts?.deferTaskHooks,
    });
    const runAttempt = this.runAttempts.create(task.id);
    let correlation = newRequestCorrelation(requestCtx.requestId);
    correlation = withTask(correlation, task.id);
    correlation = withRunAttempt(correlation, runAttempt.id);
    return { task, runAttempt, principalId, correlation };
  }
}
