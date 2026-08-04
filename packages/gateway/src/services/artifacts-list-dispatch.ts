/**
 * artifacts.list with optional harvest backfill (Phase 6 extract).
 */

import { shouldHarvestDeliverablesOnList } from "./artifacts-list.js";

export type ArtifactsListDeps = {
  getTaskStatus: (taskId: string) => string | undefined;
  /** May open the in-app browser asynchronously; return value is unused by list. */
  harvest: (taskId: string) => unknown;
  list: (taskId?: string) => unknown;
};

/**
 * List artifacts; optionally harvest deliverables for a terminal task first.
 */
export function dispatchArtifactsList(
  params: Record<string, unknown>,
  deps: ArtifactsListDeps,
): unknown {
  const taskId =
    typeof params.taskId === "string" && params.taskId
      ? params.taskId
      : undefined;
  if (taskId) {
    const status = deps.getTaskStatus(taskId);
    if (shouldHarvestDeliverablesOnList(taskId, status)) {
      // Fire-and-forget is OK for list; runner path awaits harvest on complete.
      void Promise.resolve(deps.harvest(taskId));
    }
  }
  return deps.list(taskId);
}
