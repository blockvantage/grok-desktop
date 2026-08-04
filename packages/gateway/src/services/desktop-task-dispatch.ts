/**
 * desktop.task.* IPC dispatch (Phase 6 extract from Gateway.dispatch).
 */

import {
  desktopTaskIdParam,
  desktopTaskSetGrantParams,
} from "./desktop-task-params.js";

export type DesktopTaskDispatchDeps = {
  getGrant: (taskId: string) => unknown;
  setGrant: (params: {
    taskId: string;
    granted: boolean;
    displayId?: string | null;
  }) => unknown;
  resume: (taskId: string) => unknown | Promise<unknown>;
};

export const DESKTOP_TASK_METHODS = new Set([
  "desktop.task.getGrant",
  "desktop.task.setGrant",
  "desktop.task.resume",
]);

export function isDesktopTaskMethod(method: string): boolean {
  return DESKTOP_TASK_METHODS.has(method);
}

export async function dispatchDesktopTaskMethod(
  method: string,
  params: Record<string, unknown>,
  deps: DesktopTaskDispatchDeps,
): Promise<unknown> {
  switch (method) {
    case "desktop.task.getGrant": {
      const taskId = desktopTaskIdParam(params);
      return deps.getGrant(taskId);
    }
    case "desktop.task.setGrant": {
      const p = desktopTaskSetGrantParams(params);
      if (!p) throw new Error("taskId required");
      return deps.setGrant(p);
    }
    case "desktop.task.resume": {
      const taskId = desktopTaskIdParam(params);
      return deps.resume(taskId);
    }
    default:
      throw new Error(`Unhandled desktop.task method: ${method}`);
  }
}
