import type { Task } from "@grokdesk/shared";

/**
 * Explicit immutable context for a task run (replaces preamble/engine monkey-patch).
 */
export interface RunContext {
  readonly taskId: string;
  /** Memory + attachment + role context assembled before engine start. */
  readonly systemPreamble: string;
  /** Provenance labels for what was included (no secret values). */
  readonly provenance: readonly string[];
  readonly assembledAt: string;
  /** Optional correlation: originating request / UI action id. */
  readonly requestId?: string;
  readonly runAttemptId?: string;
}

/**
 * A normal continuation sees history through its parent. A revision branches
 * before the superseded source, so neither the old request nor the newly bound
 * revised request is repeated in its transcript preamble.
 */
export function resolveHistoryCutoffId(
  task: Pick<Task, "parentTaskId" | "revisionOfTaskId">,
  getTask: (
    taskId: string,
  ) =>
    | Pick<Task, "parentTaskId" | "revisionOfTaskId">
    | null
    | undefined,
): string | null {
  if (!task.revisionOfTaskId) return task.parentTaskId;
  const seen = new Set<string>();
  let sourceTaskId: string | null = task.revisionOfTaskId;
  while (sourceTaskId) {
    if (seen.has(sourceTaskId)) return null;
    seen.add(sourceTaskId);
    const source = getTask(sourceTaskId);
    if (!source) return null;
    if (!source.revisionOfTaskId) return source.parentTaskId;
    sourceTaskId = source.revisionOfTaskId;
  }
  return null;
}

export function createRunContext(input: {
  taskId: string;
  systemPreamble: string;
  provenance?: string[];
  requestId?: string;
  runAttemptId?: string;
}): RunContext {
  return Object.freeze({
    taskId: input.taskId,
    systemPreamble: input.systemPreamble,
    provenance: Object.freeze([...(input.provenance ?? [])]),
    assembledAt: new Date().toISOString(),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.runAttemptId ? { runAttemptId: input.runAttemptId } : {}),
  });
}
