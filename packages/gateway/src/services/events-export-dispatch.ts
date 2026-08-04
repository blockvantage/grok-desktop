/**
 * events.list + chats.exportMarkdown IPC (Phase 6 extract from Gateway.dispatch).
 */

import { eventsListParams } from "./events-list-params.js";
import { exportChatMarkdown } from "./chat-export-ops.js";
import { taskIdParam } from "./task-rpc-params.js";
import type { TaskEvent } from "@grokdesk/shared";

export type EventsExportDeps = {
  listEvents: (
    taskId: string,
    afterSeq: number,
  ) => TaskEvent[];
  getTask: (id: string) => unknown;
  listTasks: () => unknown[];
  dataDir: string;
};

export const EVENTS_EXPORT_METHODS = new Set([
  "events.list",
  "events.page",
  "chats.exportMarkdown",
]);

export function isEventsExportMethod(method: string): boolean {
  return EVENTS_EXPORT_METHODS.has(method);
}

export function dispatchEventsExportMethod(
  method: string,
  params: Record<string, unknown>,
  deps: EventsExportDeps,
): unknown {
  switch (method) {
    case "events.list": {
      const p = eventsListParams(params);
      return deps.listEvents(p.taskId, p.afterSeq);
    }
    case "events.page": {
      const taskId = taskIdParam(params);
      const afterSeq =
        typeof params.afterSeq === "number" && Number.isFinite(params.afterSeq)
          ? Math.max(0, Math.floor(params.afterSeq))
          : 0;
      const limitRaw =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.floor(params.limit)
          : 200;
      const limit = Math.min(500, Math.max(1, limitRaw));
      const all = deps.listEvents(taskId, afterSeq);
      const events = all.slice(0, limit);
      const last = events[events.length - 1];
      const nextAfterSeq =
        last && typeof last.seq === "number" ? last.seq : afterSeq;
      const hasMore = all.length > events.length;
      return { events, nextAfterSeq, hasMore };
    }
    case "chats.exportMarkdown": {
      const taskId = taskIdParam(params);
      return exportChatMarkdown(taskId, {
        getTask: (id) => deps.getTask(id) as never,
        listTasks: () => deps.listTasks() as never,
        listEvents: (id, afterSeq) => deps.listEvents(id, afterSeq),
        dataDir: deps.dataDir,
      });
    }
    default:
      throw new Error(`Unhandled events/export method: ${method}`);
  }
}
