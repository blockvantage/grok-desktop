import { describe, it, expect } from "vitest";
import {
  foldTurnArtifacts,
  foldStreamArtifactItems,
  type FoldableArtifact,
  type StreamArtifactItem,
} from "./fold-turn-artifacts";

function art(
  partial: Partial<FoldableArtifact> & Pick<FoldableArtifact, "id" | "title">,
): FoldableArtifact {
  return {
    path: partial.path ?? null,
    seq: partial.seq ?? 0,
    ...partial,
  };
}

describe("foldTurnArtifacts", () => {
  it("live: keeps media + newest non-media only", () => {
    const rows = [
      art({ id: "v", title: "a.mp4", path: "/a.mp4", seq: 1 }),
      art({ id: "f1", title: "a.txt", path: "/a.txt", seq: 2 }),
      art({ id: "f2", title: "b.txt", path: "/b.txt", seq: 3 }),
    ];
    const g = foldTurnArtifacts(rows, { live: true });
    expect(g.kind).toBe("list");
    if (g.kind !== "list") return;
    expect(g.items.map((x) => x.id)).toEqual(["v", "f2"]);
  });

  it("ended: folds a multi-file turn into one digest with media + moreCount", () => {
    const rows = [
      art({ id: "v", title: "teaser.mp4", path: "/teaser.mp4", seq: 10 }),
      art({ id: "c", title: "caption.txt", path: "/caption.txt", seq: 11 }),
      art({ id: "n", title: "notes.md", path: "/notes.md", seq: 12 }),
      art({ id: "i", title: "still.png", path: "/still.png", seq: 13 }),
      art({ id: "x", title: "extra.csv", path: "/extra.csv", seq: 14 }),
      art({ id: "y", title: "log.txt", path: "/log.txt", seq: 15 }),
    ];
    const g = foldTurnArtifacts(rows, { live: false });
    expect(g.kind).toBe("digest");
    if (g.kind !== "digest") return;
    // Newest media by seq is still.png (13) over teaser.mp4 (10).
    expect(g.media?.id).toBe("i");
    expect(g.moreCount).toBe(5);
  });

  it("ended: single artifact stays a list (no digest chrome)", () => {
    const g = foldTurnArtifacts(
      [art({ id: "v", title: "a.mp4", path: "/a.mp4", seq: 1 })],
      { live: false },
    );
    expect(g).toEqual({
      kind: "list",
      items: [art({ id: "v", title: "a.mp4", path: "/a.mp4", seq: 1 })],
    });
  });

  it("ended: files-only turn digests with null media", () => {
    const rows = [
      art({ id: "a", title: "a.txt", path: "/a.txt", seq: 1 }),
      art({ id: "b", title: "b.txt", path: "/b.txt", seq: 2 }),
    ];
    const g = foldTurnArtifacts(rows, { live: false });
    expect(g.kind).toBe("digest");
    if (g.kind !== "digest") return;
    expect(g.media).toBeNull();
    expect(g.moreCount).toBe(2);
  });

  it("live turn unchanged when only media", () => {
    const rows = [
      art({ id: "v", title: "a.mp4", path: "/a.mp4", seq: 1 }),
      art({ id: "i", title: "b.png", path: "/b.png", seq: 2 }),
    ];
    const g = foldTurnArtifacts(rows, { live: true });
    expect(g.kind).toBe("list");
    if (g.kind !== "list") return;
    expect(g.items).toHaveLength(2);
  });
});

describe("foldStreamArtifactItems", () => {
  type Item =
    | { kind: "other"; id: string }
    | StreamArtifactItem;

  function isArt(it: Item): it is StreamArtifactItem {
    return it.kind === "block" && it.block.kind === "artifact";
  }

  it("inserts one digest and drops folded artifact rows", () => {
    const items: Item[] = [
      { kind: "other", id: "u" },
      {
        kind: "block",
        id: "art-1",
        block: { kind: "artifact", title: "a.mp4", path: "/a.mp4", seq: 1 },
      },
      {
        kind: "block",
        id: "art-2",
        block: { kind: "artifact", title: "b.txt", path: "/b.txt", seq: 2 },
      },
      { kind: "other", id: "z" },
    ];
    const out = foldStreamArtifactItems(items, { live: false }, isArt);
    expect(out.map((x) => x.kind)).toEqual([
      "other",
      "artifact_digest",
      "other",
    ]);
    const d = out[1] as { kind: "artifact_digest"; moreCount: number; media: { id: string } | null };
    expect(d.moreCount).toBe(1);
    expect(d.media?.id).toBe("art-1");
  });

  it("live keeps media + newest file only", () => {
    const items: Item[] = [
      {
        kind: "block",
        id: "art-1",
        block: { kind: "artifact", title: "a.mp4", path: "/a.mp4", seq: 1 },
      },
      {
        kind: "block",
        id: "art-2",
        block: { kind: "artifact", title: "b.txt", path: "/b.txt", seq: 2 },
      },
      {
        kind: "block",
        id: "art-3",
        block: { kind: "artifact", title: "c.txt", path: "/c.txt", seq: 3 },
      },
    ];
    const out = foldStreamArtifactItems(items, { live: true }, isArt);
    expect(out.map((x) => x.id)).toEqual(["art-1", "art-3"]);
  });
});
