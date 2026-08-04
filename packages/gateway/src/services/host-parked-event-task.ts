/**
 * Resolve which task id should receive a host-parked browser approval event
 * (Phase 6 extract from TaskRunner.registerHostBrowserApproval).
 */

export type LiveTaskLike = { id: string } | null | undefined;

/**
 * Prefer a live thread task; fall back to session id lookup; finally the
 * browser session id itself.
 */
export function eventTaskIdForHostParkedApproval(input: {
  browserSessionId: string;
  liveFromThread: LiveTaskLike;
  taskFromSession: LiveTaskLike;
}): string {
  return (
    input.liveFromThread?.id ??
    input.taskFromSession?.id ??
    input.browserSessionId
  );
}
