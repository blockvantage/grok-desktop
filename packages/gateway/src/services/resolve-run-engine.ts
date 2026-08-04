/**
 * Pure engine resolution for cancel / browser tool paths (Phase 6 extract).
 * Prefer the engine that started the run (hot-reload safe).
 */

/**
 * Return the pinned engine for a task when present; otherwise the current engine.
 */
export function resolveRunEngine<E>(
  enginesByTask: Map<string, E> | ReadonlyMap<string, E>,
  taskId: string,
  current: E,
): E {
  return enginesByTask.get(taskId) ?? current;
}
