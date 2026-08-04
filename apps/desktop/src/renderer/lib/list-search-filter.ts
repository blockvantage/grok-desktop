/**
 * Pure search filters for scheduled / memory / artifact list views (Phase 6).
 */

/**
 * Case-insensitive substring match on any of the provided haystacks.
 */
export function matchesSearchQuery(
  query: string,
  ...haystacks: Array<string | null | undefined>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => (h ?? "").toLowerCase().includes(q));
}

export type ScheduleSearchLike = {
  name: string;
  goalTemplate: string;
};

export function filterSchedulesBySearch<T extends ScheduleSearchLike>(
  items: T[],
  search: string,
): T[] {
  const q = search.trim();
  if (!q) return items;
  return items.filter((s) => matchesSearchQuery(q, s.name, s.goalTemplate));
}

export type MemorySearchLike = {
  title?: string | null;
  content?: string | null;
};

export function filterMemoriesBySearch<T extends MemorySearchLike>(
  items: T[],
  search: string,
): T[] {
  const q = search.trim();
  if (!q) return items;
  return items.filter((m) => matchesSearchQuery(q, m.title, m.content));
}

export type ArtifactSearchLike = {
  title?: string | null;
  path?: string | null;
  kind?: string | null;
};

export function filterArtifactsBySearch<T extends ArtifactSearchLike>(
  items: T[],
  search: string,
): T[] {
  const q = search.trim();
  if (!q) return items;
  return items.filter((a) =>
    matchesSearchQuery(q, a.title, a.path, a.kind),
  );
}
