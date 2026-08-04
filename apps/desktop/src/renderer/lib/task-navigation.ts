/**
 * Pure navigation intents for task list / workspace (Phase 6 extract from App).
 */

export type TaskSurface = "list" | "workspace";
export type TaskNavId = "tasks";

export type TaskNavState = {
  selectedId: string | null;
  taskSurface: TaskSurface;
  nav: TaskNavId | string;
};

/** Open a task in the workspace surface under Tasks nav. */
export function openTaskWorkspaceState(
  id: string,
  opts?: { approvalId?: string | null },
): Pick<TaskNavState, "selectedId" | "taskSurface" | "nav"> & {
  focusApprovalId: string | null;
} {
  return {
    selectedId: id,
    taskSurface: "workspace",
    nav: "tasks",
    focusApprovalId:
      typeof opts?.approvalId === "string" && opts.approvalId.trim()
        ? opts.approvalId.trim()
        : null,
  };
}

/** Show task list; optionally keep/set selected id. */
export function openTaskListState(
  id?: string,
  prevSelectedId: string | null = null,
): Pick<TaskNavState, "selectedId" | "taskSurface" | "nav"> {
  return {
    selectedId: id ?? prevSelectedId,
    taskSurface: "list",
    nav: "tasks",
  };
}

/** Whether cancel should no-op for optimistic placeholders. */
export function shouldSkipCancel(taskId: string): boolean {
  return taskId.startsWith("optimistic-");
}

/** Whether deleting a chat should clear selection (selected turn was in that chat). */
export function shouldClearSelectionOnDelete(
  wasSelectedInChat: boolean,
): boolean {
  return wasSelectedInChat;
}
