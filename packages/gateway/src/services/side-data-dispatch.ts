/**
 * Schedule / memory / inbox / audit IPC dispatch (Phase 6 extract from Gateway.dispatch).
 * Keeps Gateway.index thinner by isolating side-data service passthroughs.
 */

import type { AuditEntry } from "@grokdesk/shared";
import { AUDIT_DECISIONS } from "./audit-list.js";
import { okResponse } from "./simple-ok.js";

const AUDIT_DECISION_FILTER = new Set<string>(AUDIT_DECISIONS);

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
  auditList: (params: {
    taskId?: string | null;
    decision?: AuditEntry["decision"] | null;
    limit?: number;
    offset?: number;
  }) => {
    entries: AuditEntry[];
    hasMore: boolean;
    total: number;
    limit: number;
    offset: number;
  };
  listPermissionGrants?: (scopeRoot?: string) => unknown;
  revokePermissionGrant?: (scopeRoot: string, toolPattern: string) => unknown;
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
  "audit.list",
  "permissions.listGrants",
  "permissions.revokeGrant",
]);

export function isSideDataMethod(method: string): boolean {
  return SIDE_DATA_METHODS.has(method);
}

/**
 * Dispatch a schedule/memory/inbox/audit method. Throws when method is unknown.
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
    case "audit.list": {
      const taskId =
        typeof params.taskId === "string" && params.taskId
          ? params.taskId
          : undefined;
      // Fail closed: empty/missing decision → no filter.
      // Non-string or unknown non-empty decision throws (never silently
      // disable the filter and return an unfiltered trail).
      let decision: AuditEntry["decision"] | undefined;
      if (params.decision === undefined || params.decision === null) {
        decision = undefined;
      } else if (typeof params.decision !== "string") {
        throw new Error(
          `invalid audit decision filter: expected string, got ${typeof params.decision}`,
        );
      } else if (params.decision === "") {
        decision = undefined;
      } else if (!AUDIT_DECISION_FILTER.has(params.decision)) {
        throw new Error(`invalid audit decision filter: ${params.decision}`);
      } else {
        decision = params.decision as AuditEntry["decision"];
      }
      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? params.limit
          : undefined;
      const offset =
        typeof params.offset === "number" && Number.isFinite(params.offset)
          ? params.offset
          : undefined;
      return deps.auditList({ taskId, decision, limit, offset });
    }
    case "permissions.listGrants": {
      const scopeRoot =
        typeof params.scopeRoot === "string" && params.scopeRoot.trim()
          ? params.scopeRoot.trim()
          : undefined;
      return deps.listPermissionGrants?.(scopeRoot) ?? [];
    }
    case "permissions.revokeGrant": {
      const scopeRoot =
        typeof params.scopeRoot === "string" ? params.scopeRoot.trim() : "";
      const toolPattern =
        typeof params.toolPattern === "string" ? params.toolPattern.trim() : "";
      if (!scopeRoot || !toolPattern) {
        throw new Error("scopeRoot and toolPattern required");
      }
      return (
        deps.revokePermissionGrant?.(scopeRoot, toolPattern) ??
        okResponse()
      );
    }
    default:
      throw new Error(`Unhandled side-data method: ${method}`);
  }
}
