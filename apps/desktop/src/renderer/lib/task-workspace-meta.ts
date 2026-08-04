/**
 * Pure workspace-view meta from task policy + artifact lists (Phase 6 extract).
 */

export type TaskRootsLike = {
  policySnapshot?: {
    workspaceRoots?: string[] | null;
  } | null;
};

/**
 * Primary (managed) workspace root, or empty string when unset.
 */
export function primaryWorkspaceRoot(task: TaskRootsLike): string {
  return task.policySnapshot?.workspaceRoots?.[0] ?? "";
}

/**
 * Secondary project folders attached for read/write (not primary write target).
 */
export function projectWorkspaceRoots(task: TaskRootsLike): string[] {
  const roots = task.policySnapshot?.workspaceRoots ?? [];
  return roots.slice(1);
}

/**
 * Artifacts belonging to a single task id.
 */
export function filterArtifactsForTask<T extends { taskId: string }>(
  artifacts: T[],
  taskId: string,
): T[] {
  return filterArtifactsForTasks(artifacts, [taskId]);
}

/** Artifacts belonging to any turn/worker in one conversation thread. */
export function filterArtifactsForTasks<T extends { taskId: string }>(
  artifacts: T[],
  taskIds: Iterable<string>,
): T[] {
  const allowed = new Set(taskIds);
  return artifacts.filter((artifact) => allowed.has(artifact.taskId));
}
