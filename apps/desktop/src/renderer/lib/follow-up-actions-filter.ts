/**
 * Pure filter for post-run "What next?" chips (Phase 6 extract).
 */

export type FollowUpActionLike = {
  kind: string;
  id?: string;
};

/**
 * Drop takeaways when dismissed or when no handler is provided.
 */
export function filterFollowUpActions<T extends FollowUpActionLike>(
  actions: T[],
  opts: {
    takeawaysDismissed: boolean;
    hasRememberTakeaways: boolean;
  },
): T[] {
  return actions.filter((a) => {
    if (a.kind !== "takeaways") return true;
    return !opts.takeawaysDismissed && opts.hasRememberTakeaways;
  });
}
