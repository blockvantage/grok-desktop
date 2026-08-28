/**
 * Core tasks.* IPC methods excluding tasks.create (Phase 6 extract).
 * tasks.create stays in Gateway for TaskSubmissionService wiring.
 */

import { okResponse } from "./simple-ok.js";
import {
  taskIdParam,
  tasksApproveParams,
  tasksSetTitleParams,
} from "./task-rpc-params.js";
import {
  cancelOutcomeFromTaskStatus,
  isNonGatewayTaskId,
} from "./cancel-outcome.js";

export type TasksCoreDeps = {
  list: () => unknown;
  get: (taskId: string) => unknown;
  cancel: (taskId: string) => Promise<void>;
  setTitle: (taskId: string, title: string) => unknown;
  deleteChat: (taskId: string) => unknown | Promise<unknown>;
  approve: (
    approvalId: string,
    decision: "approve" | "reject",
  ) => Promise<void>;
  registerBrowserHostApproval: (params: Record<string, unknown>) => unknown;
  /** Pre-run verified desk-browser capability handshake (no secrets). */
  browserCapability?: () => unknown;
  /** Explicit user choice: allow external Chrome for this task/session. */
  allowExternalBrowser?: (params: Record<string, unknown>) => unknown;
  /** One-click open local HTML in desk agent browser (no model tool call). */
  openLocalHtml?: (
    params: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
  /** Open an HTTP(S) chat link in the task-partitioned Desk browser. */
  openUrl?: (params: Record<string, unknown>) => Promise<unknown> | unknown;
  pauseAll: () => void;
  resumeAll: () => void;
  pumpQueue: () => void;
  interject?: (
    taskId: string,
    text: string,
    clientMutationId?: string,
  ) => Promise<boolean>;
  compact?: (taskId: string) => Promise<boolean>;
  contextUsage?: (taskId: string) => {
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
  } | null;
  rewindPoints?: (taskId: string) => Promise<Array<{
    id: string;
    label?: string;
    files?: string[];
    hasFileChanges?: boolean;
  }> | null>;
  rewind?: (
    taskId: string,
    pointId: string,
    turnId?: string,
  ) => Promise<boolean>;
};

function wasActiveStatus(status: string | undefined): boolean {
  return (
    status === "running" ||
    status === "waiting_approval" ||
    status === "queued" ||
    status === "waiting_user"
  );
}

export const TASKS_CORE_METHODS = new Set([
  "tasks.list",
  "tasks.get",
  "tasks.cancel",
  "tasks.setTitle",
  "tasks.delete",
  "tasks.approve",
  "browser.hostApproval",
  "browser.capability",
  "browser.allowExternal",
  "browser.openHtml",
  "browser.openUrl",
  "tasks.pauseAll",
  "tasks.resumeAll",
  "task.interject",
  "task.compact",
  "task.contextUsage",
  "task.rewindPoints",
  "task.rewind",
]);

export function isTasksCoreMethod(method: string): boolean {
  return TASKS_CORE_METHODS.has(method);
}

export async function dispatchTasksCoreMethod(
  method: string,
  params: Record<string, unknown>,
  deps: TasksCoreDeps,
): Promise<unknown> {
  switch (method) {
    case "tasks.list":
      return deps.list();
    case "tasks.get":
      return deps.get(taskIdParam(params));
    case "tasks.cancel": {
      const taskId = taskIdParam(params);
      // Optimistic/local ids never hit the runner (desktop short-circuits too).
      if (isNonGatewayTaskId(taskId)) {
        return cancelOutcomeFromTaskStatus({
          taskFound: false,
          wasActive: false,
        });
      }
      const before = deps.get(taskId) as
        | { status?: string }
        | null
        | undefined;
      if (!before) {
        const missing = cancelOutcomeFromTaskStatus({
          taskFound: false,
          wasActive: false,
        });
        throw new Error(missing.message ?? "task not found");
      }
      const wasActive = wasActiveStatus(before.status);
      await deps.cancel(taskId);
      const after = deps.get(taskId) as
        | { status?: string; id?: string }
        | null
        | undefined;
      const outcome = cancelOutcomeFromTaskStatus({
        taskFound: true,
        statusAfter: after?.status,
        wasActive,
      });
      if (!outcome.ok) {
        throw new Error(outcome.message ?? "cancel failed");
      }
      // Preserve task snapshot return shape; attach outcome fields for clients.
      return {
        ...(after && typeof after === "object" ? after : { id: taskId }),
        ok: outcome.ok,
        ...(outcome.message ? { message: outcome.message } : {}),
      };
    }
    case "tasks.setTitle": {
      const p = tasksSetTitleParams(params);
      if (!p) throw new Error("taskId and title required");
      return deps.setTitle(p.taskId, p.resetToAuto ? "" : p.title);
    }
    case "tasks.delete":
      return deps.deleteChat(taskIdParam(params));
    case "tasks.approve": {
      const p = tasksApproveParams(params);
      if (!p) throw new Error("approvalId and decision required");
      await deps.approve(p.approvalId, p.decision);
      return okResponse();
    }
    case "browser.hostApproval":
      return deps.registerBrowserHostApproval(params);
    case "browser.capability":
      if (!deps.browserCapability) {
        return {
          ok: false,
          status: "unavailable",
          reason: "host_missing",
          tools: [],
          provider: "none",
        };
      }
      return deps.browserCapability();
    case "browser.allowExternal":
      if (!deps.allowExternalBrowser) {
        return { ok: false, allowed: false };
      }
      return deps.allowExternalBrowser(params);
    case "browser.openHtml": {
      if (!deps.openLocalHtml) {
        return { ok: false, output: "openLocalHtml not available" };
      }
      return deps.openLocalHtml(params);
    }
    case "browser.openUrl": {
      if (!deps.openUrl) {
        return { ok: false, output: "openUrl not available" };
      }
      return deps.openUrl(params);
    }
    case "tasks.pauseAll":
      deps.pauseAll();
      return okResponse();
    case "tasks.resumeAll":
      deps.resumeAll();
      deps.pumpQueue();
      return okResponse();
    case "task.interject": {
      const taskId = taskIdParam(params);
      const text = String(params.text ?? "").trim();
      if (!text) throw new Error("text required");
      // Cap mid-run interjects so a runaway client cannot flood the engine IPC.
      if (text.length > 32_000) {
        throw new Error("interject text too long (max 32000 characters)");
      }
      const clientMutationId =
        typeof params.clientMutationId === "string" &&
        params.clientMutationId.trim()
          ? params.clientMutationId.trim()
          : undefined;
      const delivered = deps.interject
        ? await deps.interject(taskId, text, clientMutationId)
        : false;
      // Only report delivered after provider/engine ack; gateway mutation
      // receipts (when clientMutationId is present) make reload replays no-ops.
      return { delivered, ...(clientMutationId ? { clientMutationId } : {}) };
    }
    case "task.compact": {
      const taskId = taskIdParam(params);
      const ok = deps.compact ? await deps.compact(taskId) : false;
      return { ok };
    }
    case "task.contextUsage": {
      const taskId = taskIdParam(params);
      return deps.contextUsage?.(taskId) ?? null;
    }
    case "task.rewindPoints": {
      const taskId = taskIdParam(params);
      return deps.rewindPoints ? await deps.rewindPoints(taskId) : null;
    }
    case "task.rewind": {
      const taskId = taskIdParam(params);
      const pointId = String(params.pointId ?? "").trim();
      if (!pointId) throw new Error("pointId required");
      const turnId =
        typeof params.turnId === "string" && params.turnId.trim()
          ? params.turnId.trim()
          : undefined;
      const ok = deps.rewind
        ? await deps.rewind(taskId, pointId, turnId)
        : false;
      return { ok };
    }
    default:
      throw new Error(`Unhandled tasks core method: ${method}`);
  }
}
