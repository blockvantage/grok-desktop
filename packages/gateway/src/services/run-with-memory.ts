/**
 * Assemble RunContext from memory / attachments / transcript and start the
 * runner queue (Phase 6 extract of Gateway.runWithMemory).
 */
import {
  buildAttachmentsPromptBlock,
  type MemoryItem,
  type Task,
  type TaskAttachment,
} from "@grokdesk/shared";
import { assembleRunPreambleFromSources } from "./run-preamble.js";
import {
  createRunContext,
  resolveHistoryCutoffId,
  type RunContext,
} from "./run-context.js";

export interface RunWithMemoryDeps {
  getTask(taskId: string): Task | null | undefined;
  retrieveMemory(goal: string): MemoryItem[];
  formatMemoryPreamble(items: MemoryItem[]): string;
  loadAttachmentsPreamble(workspaceRoot: string): string | null;
  /** Optional: conversation_id for the task. */
  getConversationId?(taskId: string): string | null | undefined;
  buildTranscriptFallback?(
    conversationId: string,
    opts: { maxChars: number; throughTaskId: string },
  ): string | null;
  setRunContext(ctx: RunContext): void;
  pumpQueue(): void;
}

export interface RunWithMemoryCorrelation {
  requestId?: string;
  runAttemptId?: string;
}

/**
 * Build immutable RunContext for a task and pump the runner.
 * No-ops when the task is missing.
 */
export function runWithMemory(
  taskId: string,
  deps: RunWithMemoryDeps,
  correlation?: RunWithMemoryCorrelation,
): void {
  const task = deps.getTask(taskId);
  if (!task) return;

  const items = deps.retrieveMemory(task.goal);
  const memoryPreamble = deps.formatMemoryPreamble(items);
  const primary = task.policySnapshot.workspaceRoots[0];
  // Accepted tasks use their exact attachment snapshot. Only pre-v8 rows,
  // whose metadata is null/absent, fall back to the cumulative manifest.
  const taskAttachments = (
    task as Task & { attachments?: TaskAttachment[] | null }
  ).attachments;
  const attachmentsPreamble = Array.isArray(taskAttachments)
    ? buildAttachmentsPromptBlock(taskAttachments)
    : primary
      ? deps.loadAttachmentsPreamble(primary)
      : null;

  let transcriptFallback: string | null = null;
  try {
    const cid = deps.getConversationId?.(taskId);
    const historyCutoffId = resolveHistoryCutoffId(task, deps.getTask);
    if (cid && historyCutoffId && deps.buildTranscriptFallback) {
      transcriptFallback = deps.buildTranscriptFallback(cid, {
        maxChars: 12_000,
        throughTaskId: historyCutoffId,
      });
    }
  } catch {
    /* ignore */
  }

  const assembled = assembleRunPreambleFromSources({
    memoryPreamble,
    memoryHitCount: items.length,
    attachmentsPreamble,
    transcriptFallback,
  });

  deps.setRunContext(
    createRunContext({
      taskId,
      systemPreamble: assembled.systemPreamble,
      provenance: assembled.provenance,
      requestId: correlation?.requestId,
      runAttemptId: correlation?.runAttemptId,
    }),
  );
  deps.pumpQueue();
}
