/**
 * Map a conversation turn to an ACP rewind point by order.
 * Plan Task 11: most recent N turns ↔ most recent N points (one point per user prompt).
 */
export type RewindPointLike = {
  id: string;
  label?: string;
  files?: string[];
  hasFileChanges?: boolean;
};

export type TurnLike = {
  id: string;
  superseded?: boolean;
};

/**
 * Align turns and points from the end: the last `points.length` non-superseded
 * turns map onto the points list in order. Earlier turns have no point.
 */
export function mapTurnToRewindPoint<T extends RewindPointLike>(
  turns: TurnLike[],
  points: T[],
  turnId: string,
): T | null {
  if (!points.length) return null;
  const active = turns.filter((t) => !t.superseded);
  const idx = active.findIndex((t) => t.id === turnId);
  if (idx < 0) return null;
  // Align from the end so trailing turns match the most recent points.
  const offset = active.length - points.length;
  const pointIdx = idx - offset;
  if (pointIdx < 0 || pointIdx >= points.length) return null;
  return points[pointIdx] ?? null;
}
