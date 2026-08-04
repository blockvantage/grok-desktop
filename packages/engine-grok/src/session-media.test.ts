import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findSessionMediaFiles,
  promoteSessionMediaToWorkspace,
  uniqueMediaName,
} from "./session-media.js";

describe("session-media", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-media-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function plantSessionImage(
    grokHome: string,
    name = "1.jpg",
    body = Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  ): string {
    const dir = path.join(
      grokHome,
      "sessions",
      "%2Ftmp%2Fws",
      "session-abc",
      "images",
    );
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    return p;
  }

  it("finds media under sessions/.../images", () => {
    const home = path.join(tmp, "home");
    const src = plantSessionImage(home);
    const found = findSessionMediaFiles(home);
    expect(found).toHaveLength(1);
    expect(found[0]!.srcPath).toBe(src);
    expect(found[0]!.relName).toBe("1.jpg");
  });

  it("ignores non-media and files outside images/videos", () => {
    const home = path.join(tmp, "home");
    plantSessionImage(home);
    const other = path.join(home, "sessions", "%2Fx", "sess", "notes.md");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, "hi");
    const loose = path.join(home, "sessions", "%2Fx", "sess", "loose.png");
    fs.writeFileSync(loose, Buffer.from([1, 2, 3]));
    expect(findSessionMediaFiles(home)).toHaveLength(1);
  });

  it("filters by sinceMs", () => {
    const home = path.join(tmp, "home");
    const src = plantSessionImage(home);
    const old = Date.now() - 60_000;
    fs.utimesSync(src, new Date(old), new Date(old));
    expect(findSessionMediaFiles(home, Date.now() - 1_000)).toHaveLength(0);
    expect(findSessionMediaFiles(home, old - 1_000)).toHaveLength(1);
  });

  it("promotes media into workspace destDir", () => {
    const home = path.join(tmp, "home");
    plantSessionImage(home, "1.jpg");
    plantSessionImage(home, "2.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const dest = path.join(tmp, "ws", "images");
    const promoted = promoteSessionMediaToWorkspace({
      grokHome: home,
      destDir: dest,
    });
    expect(promoted).toHaveLength(2);
    for (const p of promoted) {
      expect(fs.existsSync(p.destPath)).toBe(true);
      expect(p.destPath.startsWith(dest)).toBe(true);
      expect(p.kind).toBe("media");
    }
  });

  it("promotes images and videos under destRoot subfolders", () => {
    const home = path.join(tmp, "home");
    plantSessionImage(home, "1.jpg");
    const vdir = path.join(
      home,
      "sessions",
      "%2Ftmp%2Fws",
      "session-abc",
      "videos",
    );
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, "clip.mp4"), Buffer.from([0, 0, 0, 1]));
    const root = path.join(tmp, "ws");
    const promoted = promoteSessionMediaToWorkspace({
      grokHome: home,
      destRoot: root,
    });
    expect(promoted).toHaveLength(2);
    const paths = promoted.map((p) => p.destPath).sort();
    expect(paths.some((p) => p.includes(`${path.sep}images${path.sep}`))).toBe(
      true,
    );
    expect(paths.some((p) => p.includes(`${path.sep}videos${path.sep}`))).toBe(
      true,
    );
  });

  it("uniqueMediaName avoids collisions", () => {
    const used = new Set(["1.jpg"]);
    expect(uniqueMediaName("1.jpg", used)).toBe("1-2.jpg");
    expect(uniqueMediaName("hero.png", used)).toBe("hero.png");
  });

  it("uniqueMediaName strips path segments so promote cannot escape dest", () => {
    const used = new Set<string>();
    expect(uniqueMediaName("../../evil.png", used)).toBe("evil.png");
    expect(uniqueMediaName("..", used)).toBe("image.jpg");
    expect(uniqueMediaName("a/b/c.jpg", used)).toBe("c.jpg");
  });

  it("returns empty when no sessions", () => {
    expect(findSessionMediaFiles(path.join(tmp, "empty"))).toEqual([]);
    expect(
      promoteSessionMediaToWorkspace({
        grokHome: path.join(tmp, "empty"),
        destDir: path.join(tmp, "out"),
      }),
    ).toEqual([]);
  });
});
