import {
  isActiveTaskStatus,
  type Task,
  type TaskEvent,
  type TaskStatus,
} from "@grokdesk/shared";
import type { WorkerRecord } from "./activity-store";

export type SubagentHudItem = {
  taskId: string;
  name: string;
  status: TaskStatus;
  currentStep: string | null;
};

export type SubagentHud = {
  activeCount: number;
  items: SubagentHudItem[];
};

export type TaskLike = Pick<
  Task,
  "id" | "parentTaskId" | "status" | "title" | "goal"
>;

/**
 * @deprecated parentTaskId marks follow-up turns, not workers.
 * Prefer `buildSubagentHudFromWorkers` with truthful worker lifecycle events.
 * This always returns false so normal follow-ups never appear as agents.
 */
export function isLikelySubagent(
  _task: TaskLike,
  _siblings: TaskLike[],
): boolean {
  return false;
}

export function currentStepFromEvent(
  event: Pick<TaskEvent, "kind" | "payload"> | null | undefined,
): string | null {
  if (!event) return null;
  if (event.kind === "tool_request") {
    const tool = String(event.payload.tool ?? "tool");
    return tool.replace(/^browser_/, "browser ").replace(/_/g, " ");
  }
  if (event.kind === "step") {
    return String(event.payload.title ?? "step");
  }
  if (event.kind === "message" && event.payload.role === "assistant") {
    const text = String(event.payload.text ?? "").trim();
    if (!text) return null;
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }
  return null;
}

/**
 * Legacy builder: without truthful worker events, hide the HUD entirely.
 * Do not infer agents from parentTaskId follow-up turns.
 */
export function buildSubagentHud(input: {
  rootId: string;
  tasks: TaskLike[];
  latestEventsByTaskId: Record<
    string,
    Pick<TaskEvent, "kind" | "payload"> | undefined
  >;
  /** When provided, only these workers appear (truthful lifecycle). */
  workers?: WorkerRecord[];
  workersAvailable?: boolean;
}): SubagentHud | null {
  if (input.workersAvailable === false) return null;
  if (input.workers) {
    return buildSubagentHudFromWorkers(input.workers);
  }
  // No truthful worker feed — hide rather than invent from parentTaskId.
  void input.rootId;
  void input.tasks;
  void input.latestEventsByTaskId;
  return null;
}

export function buildSubagentHudFromWorkers(
  workers: WorkerRecord[],
): SubagentHud | null {
  if (!workers.length) return null;
  const items: SubagentHudItem[] = workers.map((w) => ({
    taskId: w.id,
    name: (w.label || w.objective || "Worker").slice(0, 48),
    status: mapWorkerStatus(w.status),
    currentStep: w.currentActivity,
  }));
  items.sort((a, b) => {
    const aLive = isActiveTaskStatus(a.status) ? 0 : 1;
    const bLive = isActiveTaskStatus(b.status) ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return 0;
  });
  const activeCount = items.filter((i) => isActiveTaskStatus(i.status)).length;
  return { activeCount, items };
}

function mapWorkerStatus(
  status: WorkerRecord["status"],
): TaskStatus {
  switch (status) {
    case "running":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}
