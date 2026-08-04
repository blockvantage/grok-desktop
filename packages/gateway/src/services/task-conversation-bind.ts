/**
 * Bind a submitted task into the conversation/turn ledger (TASK-02 / Phase 6).
 * Failures are non-fatal at the call site — this helper throws for the caller
 * to swallow when desired.
 */

export interface ConversationBindDeps {
  ensureForTask(input: {
    taskId: string;
    parentTaskId: string | null;
    modelId: string;
    providerId: string;
  }): { id: string };
  appendTurn(input: {
    conversationId: string;
    taskId: string;
    role: "user";
    content: string;
    contextStrategy: "transcript_fallback";
    modelId: string;
    providerId: string;
  }): void;
}

export type TaskForConversationBind = {
  id: string;
  parentTaskId: string | null;
  model: string;
  goal: string;
};

/**
 * Ensure conversation row + user turn for a newly submitted task.
 * Default providerId is "grok" until multi-provider cutover.
 */
export function bindTaskConversation(
  task: TaskForConversationBind,
  deps: ConversationBindDeps,
  opts?: { providerId?: string },
): { conversationId: string } {
  const providerId = opts?.providerId ?? "grok";
  const conversation = deps.ensureForTask({
    taskId: task.id,
    parentTaskId: task.parentTaskId,
    modelId: task.model,
    providerId,
  });
  deps.appendTurn({
    conversationId: conversation.id,
    taskId: task.id,
    role: "user",
    content: task.goal,
    contextStrategy: "transcript_fallback",
    modelId: task.model,
    providerId,
  });
  return { conversationId: conversation.id };
}

/** Best-effort wrapper: never throws. */
export function tryBindTaskConversation(
  task: TaskForConversationBind,
  deps: ConversationBindDeps,
  opts?: { providerId?: string },
): { conversationId: string } | null {
  try {
    return bindTaskConversation(task, deps, opts);
  } catch {
    return null;
  }
}
