/**
 * Pure param parsing for desktop.task.* IPC methods (Phase 6 extract).
 */

/**
 * Non-empty taskId string from params, or empty string when missing.
 */
export function desktopTaskIdParam(
  params: { taskId?: unknown } | Record<string, unknown>,
): string {
  const id = (params as { taskId?: unknown }).taskId;
  return typeof id === "string" ? id : String(id ?? "");
}

export type DesktopTaskSetGrantParams = {
  taskId: string;
  granted: boolean;
  displayId?: string | null;
};

/**
 * Normalize setGrant body; returns null when taskId missing.
 */
export function desktopTaskSetGrantParams(
  params: Record<string, unknown>,
): DesktopTaskSetGrantParams | null {
  const taskId = desktopTaskIdParam(params);
  if (!taskId) return null;
  return {
    taskId,
    granted: Boolean(params.granted),
    displayId:
      params.displayId === null || typeof params.displayId === "string"
        ? (params.displayId as string | null | undefined)
        : undefined,
  };
}
