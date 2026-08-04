import type { TaskEvent } from "@grokdesk/shared";

export function eventsByTaskForOwners(
  owners: Array<{ id: string }>,
  perTurn: Map<string, TaskEvent[]>,
): Record<string, TaskEvent[]> {
  const eventsByTask: Record<string, TaskEvent[]> = {};
  for (const owner of owners) {
    eventsByTask[owner.id] = [...(perTurn.get(owner.id) ?? [])];
  }
  return eventsByTask;
}

export function requestedChatLoading(input: {
  taskSurface: "list" | "workspace";
  requestedChatId: string;
  turnCount: number;
  ownedChatId: string;
  stateLoading: boolean;
  hasCachedOwner?: boolean;
}): boolean {
  if (input.stateLoading) return true;
  return (
    input.taskSurface === "workspace" &&
    input.requestedChatId.length > 0 &&
    input.turnCount > 0 &&
    input.ownedChatId !== input.requestedChatId &&
    !input.hasCachedOwner
  );
}
