import { describe, it, expect } from "vitest";
import {
  buildDeliverablesFromArtifacts,
  groupDeliverables,
  type DeliverableRow,
} from "./deliverables";

function row(
  partial: Partial<DeliverableRow> & Pick<DeliverableRow, "key" | "title">,
): DeliverableRow {
  return {
    path: partial.path ?? null,
    source: "artifact",
    isImage: false,
    isVideo: false,
    isAudio: false,
    ...partial,
  };
}

describe("buildDeliverablesFromArtifacts", () => {
  it("dedupes by path and uses title or basename", () => {
    const rows = buildDeliverablesFromArtifacts(
      [
        { id: "1", title: "Report", path: "/ws/out.md" },
        { id: "2", title: null, path: "/ws/shot.png" },
        { id: "3", title: "Dup", path: "/ws/out.md" },
        { id: "4", title: "No path", path: null },
      ],
      "Deliverable",
    );
    expect(rows).toHaveLength(3);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("/ws/out.md");
    expect(keys).toContain("/ws/shot.png");
    expect(keys).toContain("art:4");
    expect(rows.find((r) => r.path === "/ws/shot.png")?.isImage).toBe(true);
    expect(rows.find((r) => r.path === "/ws/out.md")?.title).toBe("Dup");
  });

  it("marks audio paths with isAudio", () => {
    const rows = buildDeliverablesFromArtifacts(
      [{ id: "a1", title: "Track", path: "/ws/track.mp3" }],
      "Deliverable",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isAudio).toBe(true);
    expect(rows[0]?.isVideo).toBe(false);
    expect(rows[0]?.isImage).toBe(false);
  });

  it("passes through optional sizeBytes", () => {
    const rows = buildDeliverablesFromArtifacts(
      [{ id: "1", title: "Clip", path: "/ws/a.mp4", sizeBytes: 12_582_912 }],
      "Deliverable",
    );
    expect(rows[0]?.sizeBytes).toBe(12_582_912);
  });
});

describe("groupDeliverables", () => {
  it("picks newest media as hero, next 4 as principal, rest as overflow", () => {
    const img1 = row({ key: "img1", title: "img1.png", path: "/img1.png", isImage: true });
    const txt1 = row({ key: "txt1", title: "notes.md", path: "/notes.md" });
    const vid2 = row({
      key: "vid2",
      title: "teaser.mp4",
      path: "/teaser.mp4",
      isVideo: true,
    });
    const file3 = row({ key: "f3", title: "a.txt", path: "/a.txt" });
    const file4 = row({ key: "f4", title: "b.txt", path: "/b.txt" });
    const file5 = row({ key: "f5", title: "c.txt", path: "/c.txt" });
    const file6 = row({ key: "f6", title: "d.txt", path: "/d.txt" });
    // Harvest order: media newest-first, then reports/files.
    const rows = [vid2, img1, txt1, file3, file4, file5, file6];
    const g = groupDeliverables(rows);
    expect(g.hero?.key).toBe(vid2.key);
    expect(g.principal.length).toBeLessThanOrEqual(4);
    expect(g.principal.map((r) => r.key)).toEqual([
      img1.key,
      txt1.key,
      file3.key,
      file4.key,
    ]);
    expect(g.overflow.map((r) => r.key)).toEqual([file5.key, file6.key]);
    expect(g.overflow.length).toBe(rows.length - 1 - g.principal.length);
  });

  it("no media → no hero, principal from the top", () => {
    const r1 = row({ key: "1", title: "a.md", path: "/a.md" });
    const r2 = row({ key: "2", title: "b.txt", path: "/b.txt" });
    const r3 = row({ key: "3", title: "c.json", path: "/c.json" });
    const g = groupDeliverables([r1, r2, r3]);
    expect(g.hero).toBeNull();
    expect(g.principal.map((x) => x.key)).toEqual(["1", "2", "3"]);
    expect(g.overflow).toEqual([]);
  });

  it("audio ranks as media for principal but is never the hero", () => {
    const audio = row({
      key: "aud",
      title: "track.mp3",
      path: "/track.mp3",
      isAudio: true,
    });
    const file = row({ key: "f", title: "notes.md", path: "/notes.md" });
    const g = groupDeliverables([audio, file]);
    expect(g.hero).toBeNull();
    expect(g.principal.map((r) => r.key)).toEqual(["aud", "f"]);
  });
});
