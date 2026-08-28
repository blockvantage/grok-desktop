/**
 * Pure param parsing for core tasks.* IPC methods (Phase 6 extract).
 */

export function taskIdParam(
  params: { taskId?: unknown } | Record<string, unknown>,
): string {
  const id = (params as { taskId?: unknown }).taskId;
  return typeof id === "string" ? id : String(id ?? "");
}

export function tasksSetTitleParams(
  params: Record<string, unknown>,
): { taskId: string; title: string; resetToAuto: boolean } | null {
  const taskId = taskIdParam(params);
  const resetToAuto = params.resetToAuto === true;
  if (!taskId) return null;
  if (resetToAuto) return { taskId, title: "", resetToAuto: true };
  const title = params.title;
  if (typeof title !== "string") return null;
  return { taskId, title, resetToAuto: false };
}

export type ApproveDecision = "approve" | "reject";

export function tasksApproveParams(
  params: Record<string, unknown>,
): { approvalId: string; decision: ApproveDecision } | null {
  const approvalId =
    typeof params.approvalId === "string" ? params.approvalId : "";
  const decision = params.decision;
  if (!approvalId) return null;
  if (decision !== "approve" && decision !== "reject") return null;
  return { approvalId, decision };
}
