/**
 * Build unique deliverable rows from artifact list (Phase 6 extract).
 * groupDeliverables ranks principal assets for the rail (ASSET-1).
 */
import { isAudioPath, isImagePath, isVideoPath } from "@/lib/api";
import { fileName, pathKey } from "@/lib/workspace-file-preview";

export type ArtifactLike = {
  id: string;
  title?: string | null;
  path?: string | null;
  /** Optional harvest payload size (ASSET-2); absent on older events. */
  sizeBytes?: number;
};

export type DeliverableRow = {
  key: string;
  title: string;
  path: string | null;
  source: "artifact";
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  sizeBytes?: number;
};

/**
 * Dedupe artifacts by path (or art:id) into rail deliverables.
 */
export function buildDeliverablesFromArtifacts(
  arts: ArtifactLike[],
  fallbackLabel: string,
): DeliverableRow[] {
  const byPath = new Map<string, DeliverableRow>();
  for (const a of arts) {
    const path = a.path ?? null;
    const key = path ? pathKey(path) : `art:${a.id}`;
    byPath.set(key, {
      key,
      title: a.title || fileName(path) || fallbackLabel,
      path,
      source: "artifact",
      isImage: isImagePath(path),
      isVideo: isVideoPath(path),
      isAudio: isAudioPath(path),
      ...(a.sizeBytes !== undefined ? { sizeBytes: a.sizeBytes } : {}),
    });
  }
  return [...byPath.values()];
}

export type DeliverableGroups = {
  hero: DeliverableRow | null;
  principal: DeliverableRow[];
  overflow: DeliverableRow[];
};

/**
 * Rank media > report > file. Hero is the first image/video (audio never
 * heroes — it stays a principal Music-icon row). Rows arrive newest-first
 * per kind from harvest; stable sort preserves that within each rank.
 */
export function groupDeliverables(rows: DeliverableRow[]): DeliverableGroups {
  const rank = (r: DeliverableRow) =>
    r.isImage || r.isVideo || r.isAudio
      ? 0
      : r.title.match(/\.(md|txt|pdf)$/i)
        ? 1
        : 2;
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
  const hero = sorted.find((r) => r.isImage || r.isVideo) ?? null;
  const rest = sorted.filter((r) => r !== hero);
  return { hero, principal: rest.slice(0, 4), overflow: rest.slice(4) };
}
