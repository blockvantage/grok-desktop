/**
 * Schedule / memory / inbox IPC dispatch (Phase 6 extract from Gateway.dispatch).
 * Keeps Gateway.index thinner by isolating side-data service passthroughs.
 */

import { okResponse } from "./simple-ok.js";

export type SideDataDeps = {
  scheduleList: () => unknown;
  scheduleCreate: (params: unknown) => unknown;
  scheduleSetEnabled: (id: string, enabled: boolean) => void;
  scheduleDelete: (id: string) => void;
  memoryList: (kind?: unknown) => unknown;
  memoryUpsert: (params: unknown) => unknown;
  memoryDelete: (id: string) => void;
  inboxList: () => unknown;
  inboxMarkRead: (id: string) => void;
  inboxDismiss: (id: string) => void;
};

export const SIDE_DATA_METHODS = new Set([
  "schedule.list",
  "schedule.create",
  "schedule.setEnabled",
  "schedule.delete",
  "memory.list",
  "memory.upsert",
  "memory.delete",
  "inbox.list",
  "inbox.markRead",
  "inbox.dismiss",
]);

export function isSideDataMethod(method: string): boolean {
  return SIDE_DATA_METHODS.has(method);
}

/**
 * Dispatch a schedule/memory/inbox method. Throws when method is unknown.
 */
export function dispatchSideDataMethod(
  method: string,
  params: Record<string, unknown>,
  deps: SideDataDeps,
): unknown {
  switch (method) {
    case "schedule.list":
      return deps.scheduleList();
    case "schedule.create":
      return deps.scheduleCreate(params);
    case "schedule.setEnabled": {
      const id = typeof params.id === "string" ? params.id : "";
      if (!id) throw new Error("id required");
      deps.scheduleSetEnabled(id, Boolean(params.enabled));
      return okResponse();
    }
    case "schedule.delete": {
      const id = typeof params.id === "string" ? params.id : "";
      if (!id) throw new Error("id required");
      deps.scheduleDelete(id);
      return okResponse();
    }
    case "memory.list":
      return deps.memoryList(params.kind);
    case "memory.upsert":
      return deps.memoryUpsert(params);
    case "memory.delete": {
      const id = typeof params.id === "string" ? params.id : "";
      if (!id) throw new Error("id required");
      deps.memoryDelete(id);
      return okResponse();
    }
    case "inbox.list":
      return deps.inboxList();
    case "inbox.markRead": {
      const id = typeof params.id === "string" ? params.id : "";
      if (!id) throw new Error("id required");
      deps.inboxMarkRead(id);
      return okResponse();
    }
    case "inbox.dismiss": {
      const id = typeof params.id === "string" ? params.id : "";
      if (!id) throw new Error("id required");
      deps.inboxDismiss(id);
      return okResponse();
    }
    default:
      throw new Error(`Unhandled side-data method: ${method}`);
  }
}
