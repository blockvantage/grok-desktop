/**
 * Collect user-facing workspace roots from a task list (Phase 6 extract — App boot).
 * Skips app-managed generated folders.
 */

import {
  isManagedWorkspacePath,
  userFacingWorkspaceRoot,
} from "./managed-workspace";

export type TaskRootLike = {
  policySnapshot?: {
    workspaceRoots?: string[] | null;
  } | null;
};

/**
 * Non-empty *user* workspace roots across tasks, preserving order.
 * Does not surface managed GrokDesk/workspaces paths.
 */
export function primaryRootsFromTasks(tasks: TaskRootLike[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const r = userFacingWorkspaceRoot(task.policySnapshot?.workspaceRoots);
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

/**
 * True when any task has a user-chosen (non-managed) workspace root.
 */
export function tasksHaveWorkspaceRoot(tasks: TaskRootLike[]): boolean {
  return tasks.some((task) => {
    const roots = task.policySnapshot?.workspaceRoots ?? [];
    return roots.some((r) => r?.trim() && !isManagedWorkspacePath(r));
  });
}
