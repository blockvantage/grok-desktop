/**
 * Map gateway TaskEvent[] into the progressive ActivityStore.
 * Used by TaskStream so the timeline is driven by the product model.
 */

import {
  emptyActivityStore,
  reduceActivity,
  type ActivityStoreState,
} from "./activity-store";
import { isBrowserToolPayload } from "./browser-ui";

/** Loose event shape so worker_* kinds can flow before shared TaskEventKind expands. */
export type ActivitySourceEvent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt?: string;
  taskId?: string;
};

export function activityStoreFromEvents(
  events: ActivitySourceEvent[],
  runId: string,
): ActivityStoreState {
  let state = emptyActivityStore();
  for (const e of events) {
    const ts = e.createdAt || new Date().toISOString();
    const id = e.id;
    if (e.kind === "message") {
      const role = String(e.payload.role ?? "");
      const text = String(e.payload.text ?? "").trim();
      if (!text) continue;
      if (role === "user") {
        state = reduceActivity(state, {
          type: "user_message",
          id,
          runId,
          timestamp: ts,
          text,
        });
      } else if (role === "assistant") {
        state = reduceActivity(state, {
          type: "assistant_message",
          id,
          runId,
          timestamp: ts,
          text,
        });
      }
      continue;
    }
    if (e.kind === "step") {
      const title = String(e.payload.title ?? "Working");
      const status = String(e.payload.status ?? "start");
      if (status === "end" || status === "done") {
        state = reduceActivity(state, {
          type: "phase_complete",
          id,
          runId,
          timestamp: ts,
          summary: title,
        });
      } else {
        state = reduceActivity(state, {
          type: "live_work",
          id,
          runId,
          timestamp: ts,
          summary: title,
        });
      }
      continue;
    }
    if (e.kind === "tool_request") {
      const tool = String(e.payload.tool ?? "tool");
      const human = tool
        .replace(/^browser_/, "Browsing · ")
        .replace(/_/g, " ");
      state = reduceActivity(state, {
        type: "live_work",
        id: `${id}-live`,
        runId,
        timestamp: ts,
        summary: human,
      });
      state = reduceActivity(state, {
        type: "tool_receipt",
        id,
        runId,
        timestamp: ts,
        summary: human,
        receipt: {
          tool,
          ...(isBrowserToolPayload(tool)
            ? { browserProvider: "desk-browser" }
            : {}),
          ...e.payload,
        },
      });
      continue;
    }
    if (e.kind === "tool_result") {
      const ok = e.payload.ok !== false;
      const tool = String(e.payload.tool ?? "tool");
      state = reduceActivity(state, {
        type: "tool_receipt",
        id,
        runId,
        timestamp: ts,
        summary: ok ? `Finished ${tool.replace(/_/g, " ")}` : `Failed ${tool}`,
        receipt: {
          ...e.payload,
          browserProvider:
            e.payload.browserProvider ??
            (isBrowserToolPayload(tool) ? "desk-browser" : undefined),
        },
      });
      continue;
    }
    if (e.kind === "approval_required") {
      state = reduceActivity(state, {
        type: "approval",
        id,
        runId,
        timestamp: ts,
        summary: String(e.payload.reason ?? "Approval needed"),
      });
      continue;
    }
    if (e.kind === "user_question" || e.kind === "question") {
      state = reduceActivity(state, {
        type: "question",
        id,
        runId,
        timestamp: ts,
        summary: String(e.payload.prompt ?? e.payload.text ?? "Question"),
      });
      continue;
    }
    // Truthful worker lifecycle from engine (when present)
    if (e.kind === "worker_started") {
      const workerId = explicitString(e.payload.workerId);
      if (!workerId) {
        state = runLevelWorkerLog(state, e, runId, ts, id);
        continue;
      }
      state = reduceActivity(state, {
        type: "worker_started",
        id,
        runId,
        workerId,
        parentWorkerId: explicitString(e.payload.parentWorkerId),
        timestamp: ts,
        label: explicitString(e.payload.label),
        objective: explicitString(e.payload.objective),
      });
      continue;
    }
    if (
      e.kind === "worker_activity" ||
      e.kind === "worker_message" ||
      e.kind === "worker_completed" ||
      e.kind === "worker_failed"
    ) {
      const workerId = explicitString(e.payload.workerId);
      if (!workerId) {
        state = runLevelWorkerLog(state, e, runId, ts, id);
        continue;
      }
      if (e.kind === "worker_activity" || e.kind === "worker_message") {
        state = reduceActivity(state, {
          type: e.kind,
          id,
          runId,
          workerId,
          parentWorkerId: explicitString(e.payload.parentWorkerId),
          timestamp: ts,
          summary: String(e.payload.summary ?? e.payload.text ?? e.kind),
        });
      } else {
        state = reduceActivity(state, {
          type: e.kind,
          id,
          runId,
          workerId,
          parentWorkerId: explicitString(e.payload.parentWorkerId),
          timestamp: ts,
          summary: String(e.payload.summary ?? e.kind),
        });
      }
      continue;
    }
    if (e.kind === "log" || e.kind === "debug") {
      state = reduceActivity(state, {
        type: "log",
        id,
        runId,
        timestamp: ts,
        summary: String(e.payload.message ?? e.payload.text ?? "log"),
        detail: JSON.stringify(e.payload).slice(0, 500),
      });
    }
  }
  return state;
}

function explicitString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function runLevelWorkerLog(
  state: ActivityStoreState,
  event: ActivitySourceEvent,
  runId: string,
  timestamp: string,
  id: string,
): ActivityStoreState {
  const summary =
    explicitString(event.payload.summary) ??
    explicitString(event.payload.text) ??
    explicitString(event.payload.label) ??
    event.kind.replace(/_/g, " ");
  return reduceActivity(state, {
    type: "log",
    id,
    runId,
    timestamp,
    summary,
    detail: JSON.stringify(event.payload),
  });
}
