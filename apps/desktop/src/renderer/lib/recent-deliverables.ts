/**
 * Recent deliverables for Home — keep finished files one click away.
 */

export type RecentArtifact = {
  id: string;
  title?: string | null;
  path?: string | null;
  createdAt?: string | null;
  taskId?: string | null;
};

export type RecentDeliverable = {
  id: string;
  title: string;
  path: string | null;
  taskId: string | null;
  createdAt: string;
};

function fileName(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Rank newest artifacts for a compact Home strip.
 */
export function rankRecentDeliverables(
  artifacts: RecentArtifact[],
  limit = 5,
): RecentDeliverable[] {
  return [...artifacts]
    .filter((a) => a.path || a.title)
    .map((a) => ({
      id: a.id,
      title: (a.title?.trim() || fileName(a.path) || "Deliverable").trim(),
      path: a.path ?? null,
      taskId: a.taskId ?? null,
      createdAt: a.createdAt || "",
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function shouldShowRecentDeliverables(
  items: RecentDeliverable[],
): boolean {
  return items.length > 0;
}
