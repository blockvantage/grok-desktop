import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWorkspaceFilePreview } from "./workspace-read-file.js";
import { PATH_OUTSIDE_WORKSPACE_ROOTS } from "./workspace-path-confine.js";

describe("readWorkspaceFilePreview", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-wrf-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads utf8 text and truncates when over maxChars", () => {
    const p = path.join(dir, "note.txt");
    fs.writeFileSync(p, "abcdefghij");
    const r = readWorkspaceFilePreview(p, 4, { allowedRoots: [dir] });
    expect(r.content).toBe("abcd");
    expect(r.truncated).toBe(true);
    expect(r.name).toBe("note.txt");
  });

  it("returns binary placeholder without dumping bytes", () => {
    const p = path.join(dir, "blob.bin");
    fs.writeFileSync(p, Buffer.from([0, 1, 2, 3, 4]));
    const r = readWorkspaceFilePreview(p, 80_000, { allowedRoots: [dir] });
    expect(r.content).toMatch(/Binary file/);
    expect(r.truncated).toBe(false);
  });

  it("throws for missing files", () => {
    expect(() =>
      readWorkspaceFilePreview(path.join(dir, "nope.txt"), 80_000, {
        allowedRoots: [dir],
      }),
    ).toThrow(/not found/i);
  });

  it("allows in-root absolute path", () => {
    const p = path.join(dir, "ok.txt");
    fs.writeFileSync(p, "hello");
    const r = readWorkspaceFilePreview(p, 80_000, { allowedRoots: [dir] });
    expect(r.content).toBe("hello");
    expect(r.path).toBe(fs.realpathSync(p));
  });

  it("denies out-of-root absolute path (e.g. /etc/passwd)", () => {
    const outside = path.resolve("/etc/passwd");
    expect(() =>
      readWorkspaceFilePreview(outside, 80_000, { allowedRoots: [dir] }),
    ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
  });

  it("denies out-of-root absolute path under home .ssh", () => {
    const outside = path.join(os.homedir(), ".ssh", "id_rsa");
    expect(() =>
      readWorkspaceFilePreview(outside, 80_000, { allowedRoots: [dir] }),
    ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
  });

  it("denies symlink inside root that points outside", () => {
    const outside = path.join(os.tmpdir(), `gd-wrf-out-${Date.now()}.txt`);
    fs.writeFileSync(outside, "secret");
    try {
      const link = path.join(dir, "escape.txt");
      fs.symlinkSync(outside, link);
      expect(() =>
        readWorkspaceFilePreview(link, 80_000, { allowedRoots: [dir] }),
      ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
