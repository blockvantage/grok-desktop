import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listDeliverableFiles,
  guessArtifactMime,
  guessArtifactKind,
} from "./workspace-deliverables.js";

describe("listDeliverableFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-deliv-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns sizeBytes for harvested files", () => {
    const file = path.join(dir, "note.txt");
    fs.writeFileSync(file, Buffer.from("hello")); // 5 bytes
    const { files, skipped } = listDeliverableFiles(dir, 40, 0);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("note.txt");
    expect(files[0]?.sizeBytes).toBe(5);
    expect(skipped).toEqual({ oversize: 0, overflow: 0 });
  });

  it("harvests a 30 MB mp4 (media ceiling 200 MB) but not a 30 MB txt", () => {
    const mp4 = path.join(dir, "teaser.mp4");
    const txt = path.join(dir, "huge.txt");
    // Sparse files — no need to write 30 MB of content.
    for (const p of [mp4, txt]) {
      const fd = fs.openSync(p, "w");
      fs.ftruncateSync(fd, 30 * 1024 * 1024);
      fs.closeSync(fd);
    }
    const { files, skipped } = listDeliverableFiles(dir, 40, 0);
    expect(files.map((f) => f.name)).toEqual(["teaser.mp4"]);
    expect(files[0]?.sizeBytes).toBe(30 * 1024 * 1024);
    expect(skipped.oversize).toBe(1);
    expect(skipped.overflow).toBe(0);
  });

  it("counts overflow past the file cap", () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.txt`), `x${i}`);
    }
    const { files, skipped } = listDeliverableFiles(dir, 3, 0);
    expect(files).toHaveLength(3);
    expect(skipped.overflow).toBe(2);
    expect(skipped.oversize).toBe(0);
  });

  it("keeps a media hero even when it exceeds the cap in walk order", () => {
    // Many non-media files plus one video; the ranked cap must not drop the
    // hero just because it was discovered late in the directory walk.
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(path.join(dir, `note-${i}.txt`), `x${i}`);
    }
    fs.writeFileSync(path.join(dir, "zzz-hero.mp4"), Buffer.from("v"));
    const { files, skipped } = listDeliverableFiles(dir, 3, 0);
    expect(files).toHaveLength(3);
    // Media sorts first, so the hero is always surfaced.
    expect(files[0]?.name).toBe("zzz-hero.mp4");
    // 7 eligible, 3 shown → 4 overflow.
    expect(skipped.overflow).toBe(4);
    expect(skipped.oversize).toBe(0);
  });
});

describe("guessArtifactMime", () => {
  it("guesses mime from extension", () => {
    expect(guessArtifactMime("a.mp4")).toBe("video/mp4");
    expect(guessArtifactMime("a.png")).toBe("image/png");
    expect(guessArtifactMime("a.mp3")).toBe("audio/mpeg");
    expect(guessArtifactMime("a.zzz")).toBeUndefined();
  });
});

describe("guessArtifactKind", () => {
  it("classifies audio extensions as media", () => {
    expect(guessArtifactKind("a.mp3")).toBe("media");
    expect(guessArtifactKind("a.wav")).toBe("media");
    expect(guessArtifactKind("a.m4a")).toBe("media");
    expect(guessArtifactKind("a.aac")).toBe("media");
    expect(guessArtifactKind("a.ogg")).toBe("media");
    expect(guessArtifactKind("a.flac")).toBe("media");
  });

  it("still classifies video/image as media and text as report", () => {
    expect(guessArtifactKind("a.mp4")).toBe("media");
    expect(guessArtifactKind("a.png")).toBe("media");
    expect(guessArtifactKind("a.md")).toBe("report");
    expect(guessArtifactKind("a.zzz")).toBe("file");
  });
});
