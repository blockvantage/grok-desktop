import { describe, it, expect } from "vitest";
import { artifactKindId, artifactKindLabel, formatBytes, shortPath } from "./format";

describe("formatBytes", () => {
  it("formats bytes, KB, and MB with one decimal when needed", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
    expect(formatBytes(2.1 * 1024 * 1024)).toBe("2.1 MB");
  });

  it("degrades gracefully for missing or invalid sizes", () => {
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(-1)).toBe("");
  });
});

describe("shortPath", () => {
  it("collapses macOS home project paths to ~/…", () => {
    expect(shortPath("/Users/maceo/payverge")).toBe("~/payverge");
    expect(shortPath("/Users/maceo/payverge/src")).toBe("~/payverge/src");
  });

  it("caps deep home paths without losing the useful tail", () => {
    expect(
      shortPath(
        "/Users/maceo/code/grok/.worktrees/release/samples/readme-demo/workspace",
      ),
    ).toBe("~/…/readme-demo/workspace");
  });

  it("collapses Linux home paths to ~/…", () => {
    expect(shortPath("/home/maceo/payverge")).toBe("~/payverge");
  });

  it("collapses Windows user paths to ~/…", () => {
    expect(shortPath("C:\\Users\\maceo\\payverge")).toBe("~/payverge");
  });

  it("leaves already-tilde and short paths alone", () => {
    expect(shortPath("~/payverge")).toBe("~/payverge");
    expect(shortPath("/tmp/x")).toBe("/tmp/x");
  });
});

describe("artifactKindId", () => {
  it("returns locale-independent kind ids", () => {
    expect(artifactKindId("notes/report.md", "Report")).toBe("markdown");
    expect(artifactKindId("data.xlsx", "Data")).toBe("excel");
    expect(artifactKindId("script.py", "Script")).toBe("python");
    expect(artifactKindId("clip.mp4", "Clip")).toBe("media");
    expect(artifactKindId("misc.bin", "Blob")).toBe("other");
  });

  it("does not group csv into excel (matches artifactKindLabel's distinct CSV label)", () => {
    expect(artifactKindLabel("data.csv", "Data")).toBe("CSV");
    expect(artifactKindId("data.csv", "Data")).toBe("other");
  });

  it("classifies image/audio extensions as media even though they are not in the label's extension map", () => {
    expect(artifactKindId("photo.png", "Photo")).toBe("media");
    expect(artifactKindId("song.mp3", "Song")).toBe("media");
  });

  it("falls back to the title's extension when path is missing, like artifactKindLabel does", () => {
    expect(artifactKindId(null, "outline.md")).toBe("markdown");
    expect(artifactKindId(undefined, "sheet.xlsx")).toBe("excel");
  });

  it("maps the .markdown extension, not just .md", () => {
    expect(artifactKindId("doc.markdown", "Doc")).toBe("markdown");
  });

  it("does not resolve Object.prototype keys as a kind (prototype-pollution-shaped filenames)", () => {
    expect(artifactKindId("evil.__proto__", "x")).toBe("other");
    expect(artifactKindId("evil.constructor", "x")).toBe("other");
    expect(artifactKindLabel("evil.__proto__", "x")).toBe("__PROTO__");
    expect(artifactKindLabel("evil.constructor", "x")).toBe("CONSTRUCTOR");
  });
});
