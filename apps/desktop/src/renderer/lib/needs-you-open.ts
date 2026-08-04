/**
 * I10: resolve needs-you open target from item + deepLink (shipped binder).
 */
export function needsYouOpenTarget(item: {
  taskId?: string | null;
  approvalId?: string | null;
  deepLink?: { taskId: string | null; approvalId: string | null } | null;
}): { taskId: string; approvalId: string | null } | null {
  const taskId = item.deepLink?.taskId ?? item.taskId ?? null;
  if (!taskId || taskId.startsWith("suggestion:")) return null;
  const approvalId =
    item.deepLink?.approvalId ?? item.approvalId ?? null;
  return { taskId, approvalId };
}
