/**
 * Collect absolute paths already recorded as artifact_created events
 * (Phase 6 extract from TaskRunner.harvestWorkspaceDeliverables).
 */

export type EventPathLike = {
  kind: string;
  payload: Record<string, unknown>;
};

/**
 * Build a set of resolved paths from artifact_created events.
 */
export function knownArtifactPathsFromEvents(
  events: EventPathLike[],
  resolvePath: (p: string) => string,
): Set<string> {
  const known = new Set<string>();
  for (const ev of events) {
    if (ev.kind === "artifact_created" && typeof ev.payload.path === "string") {
      known.add(resolvePath(ev.payload.path));
    }
  }
  return known;
}
