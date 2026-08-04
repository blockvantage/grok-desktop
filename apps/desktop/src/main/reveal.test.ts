import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const showItemInFolder = vi.fn<(p: string) => void>();
const openPath = vi.fn<(p: string) => Promise<string>>(async () => "");

vi.mock("electron", () => ({
  shell: {
    showItemInFolder: (p: string) => showItemInFolder(p),
    openPath: (p: string) => openPath(p),
  },
}));

import {
  PATH_OUTSIDE_REVEAL_ROOTS,
  collectRevealAllowedRoots,
  resolveGatewayDataDir,
  revealInFileManager,
} from "./reveal";

describe("revealInFileManager", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-reveal-"));
    showItemInFolder.mockClear();
    openPath.mockClear();
    openPath.mockResolvedValue("");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("opens existing directories with openPath when under allowed roots", async () => {
    const r = await revealInFileManager(dir, { allowedRoots: [dir] });
    expect(r.ok).toBe(true);
    expect(openPath).toHaveBeenCalledWith(fs.realpathSync(dir));
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it("reveals existing files with showItemInFolder when under allowed roots", async () => {
    const file = path.join(dir, "shot.png");
    fs.writeFileSync(file, "x");
    const r = await revealInFileManager(file, { allowedRoots: [dir] });
    expect(r.ok).toBe(true);
    expect(showItemInFolder).toHaveBeenCalledWith(fs.realpathSync(file));
  });

  it("falls back to parent when path is missing (still inside roots)", async () => {
    const gone = path.join(dir, "missing", "deep", "file.mp4");
    const r = await revealInFileManager(gone, { allowedRoots: [dir] });
    expect(r.ok).toBe(true);
    expect(openPath).toHaveBeenCalledWith(dir);
    expect(r.error).toMatch(/gone|no longer/i);
  });

  it("rejects empty path", async () => {
    const r = await revealInFileManager("  ", { allowedRoots: [dir] });
    expect(r.ok).toBe(false);
  });

  it("strips file:// prefix", async () => {
    const file = path.join(dir, "a.png");
    fs.writeFileSync(file, "x");
    const r = await revealInFileManager(`file://${file}`, {
      allowedRoots: [dir],
    });
    expect(r.ok).toBe(true);
    expect(showItemInFolder).toHaveBeenCalledWith(fs.realpathSync(file));
  });

  it("denies symlink inside roots that points outside", async () => {
    const outside = path.join(os.tmpdir(), `grokdesk-reveal-esc-${Date.now()}.txt`);
    fs.writeFileSync(outside, "secret");
    try {
      const link = path.join(dir, "escape.txt");
      fs.symlinkSync(outside, link);
      const r = await revealInFileManager(link, { allowedRoots: [dir] });
      expect(r.ok).toBe(false);
      expect(r.error).toBe(PATH_OUTSIDE_REVEAL_ROOTS);
      expect(showItemInFolder).not.toHaveBeenCalled();
      expect(openPath).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("denies paths outside all allowed roots (no shell call)", async () => {
    const outside = path.join(os.tmpdir(), `grokdesk-reveal-out-${Date.now()}`);
    fs.mkdirSync(outside, { recursive: true });
    try {
      const file = path.join(outside, "secret.txt");
      fs.writeFileSync(file, "x");
      const r = await revealInFileManager(file, { allowedRoots: [dir] });
      expect(r.ok).toBe(false);
      expect(r.error).toBe(PATH_OUTSIDE_REVEAL_ROOTS);
      expect(showItemInFolder).not.toHaveBeenCalled();
      expect(openPath).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("allows a path under a managed workspaces root", async () => {
    const workspaces = path.join(dir, "workspaces");
    const artifact = path.join(workspaces, "grok-chat-abc", "artifacts", "out.md");
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, "ok");
    const roots = collectRevealAllowedRoots({
      userDataDir: path.join(dir, "userData"),
      dataDir: dir,
    });
    const r = await revealInFileManager(artifact, { allowedRoots: roots });
    expect(r.ok).toBe(true);
    expect(showItemInFolder).toHaveBeenCalledWith(fs.realpathSync(artifact));
  });

  it("fail-closed: empty allowedRoots denies everything", async () => {
    const r = await revealInFileManager(dir, { allowedRoots: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PATH_OUTSIDE_REVEAL_ROOTS);
    expect(openPath).not.toHaveBeenCalled();
  });
});

describe("collectRevealAllowedRoots", () => {
  it("includes workspaces, exports, pending-attachments, logs, downloads", () => {
    const roots = collectRevealAllowedRoots({
      userDataDir: "/app/userData",
      dataDir: "/data/GrokDesk",
      downloadsDir: "/Users/me/Downloads",
      extraRoots: ["/Users/me/Projects/foo"],
    });
    const norm = roots.map((r) => r.replace(/\\/g, "/"));
    expect(norm).toContain(path.resolve("/data/GrokDesk/workspaces").replace(/\\/g, "/"));
    expect(norm).toContain(path.resolve("/data/GrokDesk/exports").replace(/\\/g, "/"));
    expect(norm).toContain(
      path.resolve("/app/userData/pending-attachments").replace(/\\/g, "/"),
    );
    expect(norm).toContain(path.resolve("/app/userData/logs").replace(/\\/g, "/"));
    expect(norm).toContain(path.resolve("/Users/me/Downloads").replace(/\\/g, "/"));
    expect(norm).toContain(path.resolve("/Users/me/Projects/foo").replace(/\\/g, "/"));
  });
});

describe("resolveGatewayDataDir", () => {
  it("matches gateway darwin layout", () => {
    expect(
      resolveGatewayDataDir({
        platform: "darwin",
        home: "/Users/me",
      }),
    ).toBe(
      path.join("/Users/me", "Library", "Application Support", "GrokDesk"),
    );
  });
});
