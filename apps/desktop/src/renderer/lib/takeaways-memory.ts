/**
 * Pure takeaways memory upsert payload (Phase 6 extract from App).
 */

export type TakeawaysTaskLike = {
  id: string;
  goal: string;
  title?: string | null;
};

export type TakeawaysEventLike = {
  kind: string;
  payload: Record<string, unknown>;
};

/**
 * Whether the open chat's in-memory events cover this taskId
 * (otherwise fetch events.list for that task).
 */
export function shouldReuseLocalEventsForTakeaways(input: {
  selectedId: string | null | undefined;
  workspaceTaskId: string | null | undefined;
  targetTaskId: string;
}): boolean {
  return (
    input.selectedId === input.targetTaskId ||
    input.workspaceTaskId === input.targetTaskId
  );
}

/**
 * Memory upsert fields for episodic takeaways.
 */
export function takeawaysMemoryUpsert(input: {
  task: TakeawaysTaskLike;
  events: TakeawaysEventLike[];
  buildContent: (args: {
    taskId: string;
    goal: string;
    events: TakeawaysEventLike[];
  }) => string;
}): {
  kind: "episodic";
  title: string;
  content: string;
  provenance: string;
} {
  const content = input.buildContent({
    taskId: input.task.id,
    goal: input.task.goal,
    events: input.events,
  });
  const label = (input.task.title || input.task.goal).slice(0, 60);
  return {
    kind: "episodic",
    title: `Takeaways: ${label}`,
    content,
    provenance: `task:${input.task.id}`,
  };
}
