/**
 * Build the full task list for a chat workspace (turns + concurrent children).
 * Phase 6 extract from App TaskWorkspaceView threadTasks prop.
 */

export type ThreadTaskLike = {
  id: string;
  parentTaskId?: string | null;
};

/**
 * Chat turns plus concurrent children of the chat root (or of any turn).
 */
export function threadTasksForWorkspace<T extends ThreadTaskLike>(input: {
  rootId: string;
  turns: T[];
  allTasks: T[];
}): T[] {
  const turnIds = new Set(input.turns.map((t) => t.id));
  const extras = input.allTasks.filter(
    (t) =>
      !turnIds.has(t.id) &&
      (t.parentTaskId === input.rootId ||
        (t.parentTaskId != null && turnIds.has(t.parentTaskId))),
  );
  return [...input.turns, ...extras];
}
