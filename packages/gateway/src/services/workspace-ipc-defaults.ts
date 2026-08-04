/**
 * Default limits for workspace.* IPC methods (Phase 6 extract).
 */

export const DEFAULT_WORKSPACE_LIST_MAX = 40;
export const DEFAULT_WORKSPACE_READ_MAX_CHARS = 80_000;
export const DEFAULT_WORKSPACE_ASSET_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_WORKSPACE_PREPARE_MAX_BYTES = 256 * 1024 * 1024;

export function workspaceListMax(param?: number): number {
  return typeof param === "number" && Number.isFinite(param) && param > 0
    ? Math.floor(param)
    : DEFAULT_WORKSPACE_LIST_MAX;
}

export function workspaceReadMaxChars(param?: number): number {
  return typeof param === "number" && Number.isFinite(param) && param > 0
    ? Math.floor(param)
    : DEFAULT_WORKSPACE_READ_MAX_CHARS;
}

export function workspaceAssetMaxBytes(param?: number): number {
  return typeof param === "number" && Number.isFinite(param) && param > 0
    ? Math.floor(param)
    : DEFAULT_WORKSPACE_ASSET_MAX_BYTES;
}

export function workspacePrepareMaxBytes(param?: number): number {
  return typeof param === "number" && Number.isFinite(param) && param > 0
    ? Math.floor(param)
    : DEFAULT_WORKSPACE_PREPARE_MAX_BYTES;
}
