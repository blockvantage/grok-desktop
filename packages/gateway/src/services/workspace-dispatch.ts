/**
 * workspace.* IPC dispatch (Phase 6 extract from Gateway.dispatch).
 */

import {
  ensureTempWorkspaceLabel,
  optionalWorkspaceRoot,
} from "./workspace-params.js";
import {
  workspaceAssetMaxBytes,
  workspaceListMax,
  workspacePrepareMaxBytes,
  workspaceReadMaxChars,
} from "./workspace-ipc-defaults.js";

export type WorkspaceDispatchDeps = {
  ensureTemp: (label: string) => unknown;
  listFiles: (root: string, max: number) => unknown;
  readFile: (path: string, maxChars: number) => unknown;
  readAsset: (
    path: string,
    maxBytes: number,
    root?: string,
  ) => unknown;
  prepareAsset: (
    path: string,
    maxBytes: number,
    root?: string,
  ) => unknown;
};

export const WORKSPACE_METHODS = new Set([
  "workspace.ensureTemp",
  "workspace.listFiles",
  "workspace.readFile",
  "workspace.readAsset",
  "workspace.prepareAsset",
]);

export function isWorkspaceMethod(method: string): boolean {
  return WORKSPACE_METHODS.has(method);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function dispatchWorkspaceMethod(
  method: string,
  params: Record<string, unknown>,
  deps: WorkspaceDispatchDeps,
): unknown {
  switch (method) {
    case "workspace.ensureTemp":
      return deps.ensureTemp(ensureTempWorkspaceLabel(params));
    case "workspace.listFiles": {
      const root = typeof params.root === "string" ? params.root : "";
      return deps.listFiles(root, workspaceListMax(optionalNumber(params.max)));
    }
    case "workspace.readFile": {
      const path = typeof params.path === "string" ? params.path : "";
      return deps.readFile(
        path,
        workspaceReadMaxChars(optionalNumber(params.maxChars)),
      );
    }
    case "workspace.readAsset": {
      const path = typeof params.path === "string" ? params.path : "";
      return deps.readAsset(
        path,
        workspaceAssetMaxBytes(optionalNumber(params.maxBytes)),
        optionalWorkspaceRoot(params),
      );
    }
    case "workspace.prepareAsset": {
      const path = typeof params.path === "string" ? params.path : "";
      return deps.prepareAsset(
        path,
        workspacePrepareMaxBytes(optionalNumber(params.maxBytes)),
        optionalWorkspaceRoot(params),
      );
    }
    default:
      throw new Error(`Unhandled workspace method: ${method}`);
  }
}
