/**
 * Pure params for events.list IPC (Phase 6 extract).
 */

export function eventsListParams(
  params: { taskId?: unknown; afterSeq?: unknown } | Record<string, unknown>,
): { taskId: string; afterSeq: number } {
  const taskId = String((params as { taskId?: unknown }).taskId ?? "");
  const raw = (params as { afterSeq?: unknown }).afterSeq;
  const afterSeq =
    typeof raw === "number" && Number.isFinite(raw)
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : 0;
  return {
    taskId,
    afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
  };
}
