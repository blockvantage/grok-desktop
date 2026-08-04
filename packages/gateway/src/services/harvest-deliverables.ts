/**
 * Pure selection of workspace files to register as artifacts on harvest.
 */

export type HarvestFile = {
  name: string;
  path: string;
  sizeBytes?: number;
};
export type HarvestArtifactEvent = {
  title: string;
  path: string;
  kind: "file" | "report" | "media" | "card";
  sizeBytes?: number;
  mime?: string;
};

/**
 * Drop files already known from artifact_created events; map to event payloads.
 * `resolvePath` and `guessKind` injected for testability.
 */
export function selectNewDeliverableArtifacts(
  files: HarvestFile[],
  knownPaths: Set<string>,
  opts: {
    resolvePath: (p: string) => string;
    guessKind: (name: string) => HarvestArtifactEvent["kind"];
    guessMime?: (name: string) => string | undefined;
  },
): HarvestArtifactEvent[] {
  const out: HarvestArtifactEvent[] = [];
  const known = new Set(knownPaths);
  for (const file of files) {
    const abs = opts.resolvePath(file.path);
    if (known.has(abs)) continue;
    known.add(abs);
    const mime = opts.guessMime?.(file.name);
    const item: HarvestArtifactEvent = {
      title: file.name,
      path: abs,
      kind: opts.guessKind(file.name),
    };
    if (file.sizeBytes !== undefined) item.sizeBytes = file.sizeBytes;
    if (mime !== undefined) item.mime = mime;
    out.push(item);
  }
  return out;
}

/** Parse task.createdAt with 30s slack for mtime lower bound. */
export function harvestSinceMs(createdAtIso: string, nowMs = Date.now()): number {
  const startedMs = Date.parse(createdAtIso);
  if (!Number.isFinite(startedMs)) return 0;
  void nowMs;
  return startedMs - 30_000;
}
