/**
 * Fan-out for extracted domain IPC handlers (Phase 6).
 * Gateway.dispatch default branch routes here so index stays thin.
 */

import {
  dispatchTasksCoreMethod,
  isTasksCoreMethod,
  type TasksCoreDeps,
} from "./tasks-core-dispatch.js";
import {
  dispatchAuthMethod,
  isAuthMethod,
  type AuthDispatchDeps,
} from "./auth-dispatch.js";
import {
  dispatchDesktopTaskMethod,
  isDesktopTaskMethod,
  type DesktopTaskDispatchDeps,
} from "./desktop-task-dispatch.js";
import {
  dispatchSettingsMethod,
  isSettingsMethod,
  type SettingsDispatchDeps,
} from "./settings-dispatch.js";
import {
  dispatchLicenseMetaMethod,
  isLicenseMetaMethod,
  type LicenseMetaDeps,
} from "./license-meta-dispatch.js";
import {
  dispatchConnectorMethod,
  isConnectorMethod,
  type ConnectorDispatchDeps,
} from "./connector-dispatch.js";
import {
  dispatchWorkspaceMethod,
  isWorkspaceMethod,
  type WorkspaceDispatchDeps,
} from "./workspace-dispatch.js";
import {
  dispatchSideDataMethod,
  isSideDataMethod,
  type SideDataDeps,
} from "./side-data-dispatch.js";
import {
  dispatchEventsExportMethod,
  isEventsExportMethod,
  type EventsExportDeps,
} from "./events-export-dispatch.js";
import {
  dispatchArtifactsList,
  type ArtifactsListDeps,
} from "./artifacts-list-dispatch.js";
import {
  dispatchOutboxMethod,
  isOutboxMethod,
  type OutboxDispatchDeps,
} from "./outbox-dispatch.js";

export type DomainDispatchDeps = {
  tasksCore: TasksCoreDeps;
  auth: AuthDispatchDeps;
  desktopTask: DesktopTaskDispatchDeps;
  settings: SettingsDispatchDeps;
  licenseMeta: LicenseMetaDeps;
  connectors: ConnectorDispatchDeps;
  workspace: WorkspaceDispatchDeps;
  sideData: SideDataDeps;
  eventsExport: EventsExportDeps;
  artifactsList: ArtifactsListDeps;
  outbox?: OutboxDispatchDeps;
};

/**
 * Route a non-create IPC method through domain handlers.
 * Returns { handled: false } when no domain owns the method.
 */
export async function dispatchDomainMethod(
  method: string,
  params: Record<string, unknown>,
  deps: DomainDispatchDeps,
): Promise<{ handled: true; result: unknown } | { handled: false }> {
  if (isTasksCoreMethod(method)) {
    return {
      handled: true,
      result: await dispatchTasksCoreMethod(method, params, deps.tasksCore),
    };
  }
  if (isAuthMethod(method)) {
    return {
      handled: true,
      result: await dispatchAuthMethod(method, deps.auth),
    };
  }
  if (isDesktopTaskMethod(method)) {
    return {
      handled: true,
      result: await dispatchDesktopTaskMethod(
        method,
        params,
        deps.desktopTask,
      ),
    };
  }
  if (isSettingsMethod(method)) {
    return {
      handled: true,
      result: await dispatchSettingsMethod(method, params, deps.settings),
    };
  }
  if (isLicenseMetaMethod(method)) {
    return {
      handled: true,
      result: await dispatchLicenseMetaMethod(
        method,
        params,
        deps.licenseMeta,
      ),
    };
  }
  if (isConnectorMethod(method)) {
    return {
      handled: true,
      result: await dispatchConnectorMethod(method, params, deps.connectors),
    };
  }
  if (isWorkspaceMethod(method)) {
    return {
      handled: true,
      result: dispatchWorkspaceMethod(method, params, deps.workspace),
    };
  }
  if (isSideDataMethod(method)) {
    return {
      handled: true,
      result: dispatchSideDataMethod(method, params, deps.sideData),
    };
  }
  if (isEventsExportMethod(method)) {
    return {
      handled: true,
      result: dispatchEventsExportMethod(method, params, deps.eventsExport),
    };
  }
  if (method === "artifacts.list") {
    return {
      handled: true,
      result: dispatchArtifactsList(params, deps.artifactsList),
    };
  }
  if (deps.outbox && isOutboxMethod(method)) {
    return {
      handled: true,
      result: await dispatchOutboxMethod(method, params, deps.outbox),
    };
  }
  return { handled: false };
}
