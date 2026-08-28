import type { UsageSnapshot } from "./types.js";

/**
 * Neutral runtime events emitted by AgentSession.runTurn.
 * Independent of Grok streaming-json shapes.
 */
export type RuntimeEvent =
  | {
      type: "message";
      role: "assistant" | "user" | "system";
      text: string;
      channel?: "text" | "thought";
    }
  | { type: "step"; title: string; status: "start" | "end" }
  | { type: "run_progress"; message: string }
  | {
      type: "permission_request";
      id: string;
      tool: string;
      path?: string;
      command?: string;
      meta?: Record<string, unknown>;
    }
  | {
      type: "pending_interaction";
      id: string;
      kind: string;
      title: string;
    }
  | { type: "interaction_resolved"; id: string }
  | {
      type: "tool_call";
      id: string;
      tool: string;
      path?: string;
      command?: string;
      meta?: Record<string, unknown>;
    }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | {
      type: "artifact";
      title: string;
      path: string;
      kind: "file" | "report" | "media" | "card";
    }
  | { type: "usage"; usage: UsageSnapshot }
  | {
      type: "session_status";
      status: Record<string, unknown>;
    }
  | {
      type: "goal_update";
      objective?: string;
      progress?: string;
    }
  | {
      type: "workflow_update";
      payload: Record<string, unknown>;
    }
  | {
      type: "memory_update";
      action: "recalled" | "updated" | "other";
      title?: string;
      content?: string;
    }
  | {
      type: "monitor_event";
      payload: Record<string, unknown>;
    }
  | {
      type: "scheduled_task";
      payload: Record<string, unknown>;
    }
  | {
      type: "plan";
      content: string;
      status: "drafting" | "awaiting_approval";
    }
  | {
      type: "citations";
      items: Array<{
        url: string;
        title?: string;
        snippet?: string;
        source?: "web" | "x" | "other";
      }>;
    }
  | { type: "done"; summary: string }
  | { type: "error"; message: string; code?: string }
  | {
      type: "worker_started";
      workerId: string;
      label?: string;
    }
  | {
      type: "worker_activity";
      workerId: string;
      summary?: string;
    }
  | {
      type: "worker_completed";
      workerId: string;
      summary?: string;
    };

export type RuntimeEventSignal = "continue" | "abort";

export type RuntimeEventSink = (
  event: RuntimeEvent,
) => Promise<RuntimeEventSignal>;
