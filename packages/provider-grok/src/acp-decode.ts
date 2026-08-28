/**
 * Forward-compatible ACP decode: unknown session/update variants and ToolKinds
 * fall into an `unknown`/`other` sink and never throw.
 */
export type SessionUpdateKind =
  | "agent_message_chunk"
  | "tool_call"
  | "tool_call_update"
  | "plan"
  | "session_status"
  | "turn_completed"
  | "pending_interaction"
  | "interaction_resolved"
  | "subagent_spawned"
  | "subagent_progress"
  | "subagent_finished"
  | "auto_compact_started"
  | "auto_compact_completed"
  | "auto_compact_failed"
  | "goal_updated"
  | "workflow_updated"
  | "memory_updated"
  | "memory_recalled"
  | "monitor_event"
  | "scheduled_task_created"
  | "scheduled_task_fired"
  | "scheduled_task_deleted"
  | "unknown";

const KNOWN_UPDATES = new Set<SessionUpdateKind>([
  "agent_message_chunk",
  "tool_call",
  "tool_call_update",
  "plan",
  "session_status",
  "turn_completed",
  "pending_interaction",
  "interaction_resolved",
  "subagent_spawned",
  "subagent_progress",
  "subagent_finished",
  "auto_compact_started",
  "auto_compact_completed",
  "auto_compact_failed",
  "goal_updated",
  "workflow_updated",
  "memory_updated",
  "memory_recalled",
  "monitor_event",
  "scheduled_task_created",
  "scheduled_task_fired",
  "scheduled_task_deleted",
]);

const KNOWN_TOOL_KINDS = new Set([
  "read",
  "edit",
  "write",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
]);

export function decodeSessionUpdate(update: unknown): {
  kind: SessionUpdateKind;
  raw: Record<string, unknown>;
} {
  if (!update || typeof update !== "object") {
    return { kind: "unknown", raw: {} };
  }
  const raw = update as Record<string, unknown>;
  const rawToken =
    typeof raw.sessionUpdate === "string" ? raw.sessionUpdate : "";
  const token =
    rawToken === "SessionStatus"
      ? "session_status"
      : rawToken === "TurnCompleted"
        ? "turn_completed"
        : rawToken === "PendingInteraction"
          ? "pending_interaction"
          : rawToken === "InteractionResolved"
            ? "interaction_resolved"
            : rawToken === "SubagentSpawned"
              ? "subagent_spawned"
              : rawToken === "SubagentProgress"
                ? "subagent_progress"
                : rawToken === "SubagentFinished"
                  ? "subagent_finished"
                  : rawToken === "AutoCompactStarted"
                    ? "auto_compact_started"
                    : rawToken === "AutoCompactCompleted"
                      ? "auto_compact_completed"
                      : rawToken === "AutoCompactFailed"
                        ? "auto_compact_failed"
                        : rawToken === "GoalUpdated"
                          ? "goal_updated"
                          : rawToken === "WorkflowUpdated"
                            ? "workflow_updated"
                            : rawToken === "MemoryUpdated"
                              ? "memory_updated"
                              : rawToken === "MemoryRecalled"
                                ? "memory_recalled"
                                : rawToken === "MonitorEvent"
                                  ? "monitor_event"
                                  : rawToken === "ScheduledTaskCreated"
                                    ? "scheduled_task_created"
                                    : rawToken === "ScheduledTaskFired"
                                      ? "scheduled_task_fired"
                                      : rawToken === "ScheduledTaskDeleted"
                                        ? "scheduled_task_deleted"
                                        : rawToken;
  const kind = KNOWN_UPDATES.has(token as SessionUpdateKind)
    ? (token as SessionUpdateKind)
    : "unknown";
  return { kind, raw };
}

export function decodeToolKind(kind: unknown): string {
  if (typeof kind !== "string" || !kind.trim()) return "other";
  const token = kind.trim();
  if (KNOWN_TOOL_KINDS.has(token)) return token;
  return "other";
}
