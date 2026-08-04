import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadAttachmentsPreamble,
  stageTaskAttachments,
} from "./attachment-stage.js";

let dir: string;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("stageTaskAttachments", () => {
  it("copies images into primary/attachments and leaves files as path refs", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-"));
    const primary = path.join(dir, "primary");
    fs.mkdirSync(primary);
    const img = path.join(dir, "photo.png");
    fs.writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const pdf = path.join(dir, "doc.pdf");
    fs.writeFileSync(pdf, "%PDF-1.4");

    const out = stageTaskAttachments(primary, [
      {
        id: "1",
        name: "photo.png",
        sourcePath: img,
        kind: "image",
        sizeBytes: 4,
      },
      {
        id: "2",
        name: "doc.pdf",
        sourcePath: pdf,
        kind: "file",
        sizeBytes: 8,
      },
    ]);

    expect(out[0]!.stagedPath).toMatch(/attachments[/\\]photo\.png$/);
    expect(fs.existsSync(out[0]!.stagedPath!)).toBe(true);
    expect(out[1]!.stagedPath).toBeUndefined();
    expect(out[1]!.sourcePath).toBe(path.resolve(pdf));
    // PDF must not appear under primary/attachments
    const attDir = path.join(primary, "attachments");
    const names = fs.readdirSync(attDir);
    expect(names).toContain("photo.png");
    expect(names).toContain("manifest.json");
    expect(names).not.toContain("doc.pdf");
  });

  it("rejects missing files", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-miss-"));
    const primary = path.join(dir, "primary");
    fs.mkdirSync(primary);
    expect(() =>
      stageTaskAttachments(primary, [
        {
          id: "1",
          name: "gone.png",
          sourcePath: path.join(dir, "nope.png"),
          kind: "image",
        },
      ]),
    ).toThrow(/not found/i);
  });

  it("reuses a retained staged image without copying or duplicating manifest entries", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-retained-"));
    const primary = path.join(dir, "primary");
    const attachmentsDir = path.join(primary, "attachments");
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const stagedPath = path.join(attachmentsDir, "retained.png");
    fs.writeFileSync(stagedPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const input = {
      id: "retained",
      name: "retained.png",
      sourcePath: path.join(dir, "deleted-original.png"),
      stagedPath,
      kind: "image" as const,
    };

    const first = stageTaskAttachments(primary, [input]);
    const second = stageTaskAttachments(primary, [input]);

    const realStaged = fs.realpathSync(stagedPath);
    expect(first[0]?.stagedPath).toBe(realStaged);
    expect(second[0]?.stagedPath).toBe(realStaged);
    expect(fs.readdirSync(attachmentsDir).sort()).toEqual([
      "manifest.json",
      "retained.png",
    ]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(attachmentsDir, "manifest.json"), "utf8"),
    ) as Array<{ stagedPath?: string }>;
    expect(
      manifest.filter((item) => item.stagedPath === realStaged),
    ).toHaveLength(1);
  });

  it("writes a manifest for engine preamble without requiring goal merge", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-man-"));
    const primary = path.join(dir, "primary");
    fs.mkdirSync(primary);
    const img = path.join(dir, "photo.png");
    fs.writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const pdf = path.join(dir, "doc.pdf");
    fs.writeFileSync(pdf, "%PDF");
    stageTaskAttachments(primary, [
      {
        id: "1",
        name: "photo.png",
        sourcePath: img,
        kind: "image",
      },
      {
        id: "2",
        name: "doc.pdf",
        sourcePath: pdf,
        kind: "file",
      },
    ]);
    const preamble = loadAttachmentsPreamble(primary);
    expect(preamble).toContain("Attached images");
    expect(preamble).toMatch(/attachments[/\\]photo\.png/);
    expect(preamble).toContain("doc.pdf");
  });

  it("rejects more than MAX_ATTACHMENTS", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-max-"));
    const primary = path.join(dir, "primary");
    fs.mkdirSync(primary);
    const items = Array.from({ length: 11 }, (_, i) => {
      const p = path.join(dir, `f${i}.txt`);
      fs.writeFileSync(p, "x");
      return {
        id: String(i),
        name: `f${i}.txt`,
        sourcePath: p,
        kind: "file" as const,
      };
    });
    expect(() => stageTaskAttachments(primary, items)).toThrow(/Too many/i);
  });

  it("ignores oversized or non-array attachment manifests", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-man-bounds-"));
    const primary = path.join(dir, "primary");
    fs.mkdirSync(path.join(primary, "attachments"), { recursive: true });
    const manifest = path.join(primary, "attachments", "manifest.json");
    fs.writeFileSync(manifest, Buffer.alloc(300 * 1024, 0x41));
    expect(loadAttachmentsPreamble(primary)).toBe("");

    fs.writeFileSync(manifest, '{"not":"array"}');
    expect(loadAttachmentsPreamble(primary)).toBe("");
  });

  it("caps retained prior manifest entries when merging", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-man-cap-"));
    const primary = path.join(dir, "primary");
    fs.mkdirSync(path.join(primary, "attachments"), { recursive: true });
    const manifest = path.join(primary, "attachments", "manifest.json");
    const bloated = Array.from({ length: 80 }, (_, i) => ({
      id: `old-${i}`,
      name: `old-${i}.txt`,
      sourcePath: `/tmp/old-${i}.txt`,
      kind: "file" as const,
    }));
    fs.writeFileSync(manifest, JSON.stringify(bloated));
    const pdf = path.join(dir, "doc.pdf");
    fs.writeFileSync(pdf, "%PDF");
    stageTaskAttachments(primary, [
      {
        id: "new",
        name: "doc.pdf",
        sourcePath: pdf,
        kind: "file",
      },
    ]);
    const stored = JSON.parse(fs.readFileSync(manifest, "utf8")) as unknown[];
    expect(stored.length).toBeLessThanOrEqual(64);
    expect(JSON.stringify(stored)).toContain("doc.pdf");
  });
});
