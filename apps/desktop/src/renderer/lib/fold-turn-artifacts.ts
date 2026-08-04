/**
 * Turn-end deliverables digest (ASSET-3): fold non-media artifact noise into
 * one card while media stays playable inline.
 */
import { isAudioPath, isImagePath, isVideoPath } from "@/lib/api";

export type FoldableArtifact = {
  id: string;
  title: string;
  path?: string | null;
  seq: number;
};

export function isPlayableMediaArtifact(
  path: string | null | undefined,
): boolean {
  return isImagePath(path) || isVideoPath(path) || isAudioPath(path);
}

export type FoldedTurnArtifacts =
  | { kind: "list"; items: FoldableArtifact[] }
  | {
      kind: "digest";
      /** Newest image/video/audio of the turn (inline-playable). */
      media: FoldableArtifact | null;
      /** How many artifacts are folded behind the media (or total when no media). */
      moreCount: number;
      items: FoldableArtifact[];
    };

/**
 * Live turns: keep every media artifact + only the newest non-media row.
 * Ended turns: one digest when 2+ artifacts (hero media + "{n} more files").
 * Single-artifact turns stay a plain list (no digest chrome).
 */
export function foldTurnArtifacts(
  artifacts: FoldableArtifact[],
  opts: { live: boolean },
): FoldedTurnArtifacts {
  if (artifacts.length === 0) return { kind: "list", items: [] };

  if (opts.live) {
    let lastNonMediaId: string | null = null;
    for (let i = artifacts.length - 1; i >= 0; i--) {
      const a = artifacts[i]!;
      if (!isPlayableMediaArtifact(a.path)) {
        lastNonMediaId = a.id;
        break;
      }
    }
    const items = artifacts.filter(
      (a) =>
        isPlayableMediaArtifact(a.path) ||
        (lastNonMediaId != null && a.id === lastNonMediaId),
    );
    return { kind: "list", items };
  }

  if (artifacts.length <= 1) {
    return { kind: "list", items: artifacts };
  }

  let media: FoldableArtifact | null = null;
  for (const a of artifacts) {
    if (!isPlayableMediaArtifact(a.path)) continue;
    if (!media || a.seq >= media.seq) media = a;
  }
  const moreCount = artifacts.length - (media ? 1 : 0);
  if (moreCount <= 0) {
    return { kind: "list", items: artifacts };
  }
  return { kind: "digest", media, moreCount, items: artifacts };
}

/** Stream-item shape needed to fold artifact blocks in place. */
export type StreamArtifactItem = {
  kind: "block";
  id: string;
  block: {
    kind: "artifact";
    id?: string;
    title: string;
    path?: string;
    seq: number;
  };
};

export type StreamDigestItem = {
  kind: "artifact_digest";
  id: string;
  media: FoldableArtifact | null;
  moreCount: number;
  seq: number;
};

/**
 * Fold artifact blocks inside a mixed stream. Non-artifact items pass through.
 * Live: same as foldTurnArtifacts list filter. Ended: replace the artifact
 * group with a single digest (or keep media-only list when no files).
 */
export function foldStreamArtifactItems<T extends { kind: string; id: string }>(
  items: T[],
  opts: { live: boolean },
  isArtifact: (it: T) => it is T & StreamArtifactItem,
): Array<T | StreamDigestItem> {
  const arts: FoldableArtifact[] = [];
  for (const it of items) {
    if (!isArtifact(it)) continue;
    arts.push({
      id: it.id,
      title: it.block.title,
      path: it.block.path,
      seq: it.block.seq,
    });
  }
  if (arts.length === 0) return items;

  const folded = foldTurnArtifacts(arts, opts);
  if (folded.kind === "list") {
    const keep = new Set(folded.items.map((a) => a.id));
    return items.filter((it) => !isArtifact(it) || keep.has(it.id));
  }

  const digest: StreamDigestItem = {
    kind: "artifact_digest",
    id: `digest-${folded.items[folded.items.length - 1]!.id}`,
    media: folded.media,
    moreCount: folded.moreCount,
    seq: folded.media?.seq ?? folded.items[folded.items.length - 1]!.seq,
  };
  const remove = new Set(arts.map((a) => a.id));
  const out: Array<T | StreamDigestItem> = [];
  let inserted = false;
  for (const it of items) {
    if (isArtifact(it) && remove.has(it.id)) {
      if (!inserted) {
        out.push(digest);
        inserted = true;
      }
      continue;
    }
    out.push(it);
  }
  return out;
}
