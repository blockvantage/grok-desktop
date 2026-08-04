import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  prepareWorkspaceAssetMeta,
  readWorkspaceAssetDataUrl,
  mediaMimeForPath,
  resolveWorkspacePath,
} from "./workspace-asset.js";
import { PATH_OUTSIDE_WORKSPACE_ROOTS } from "./services/workspace-path-confine.js";

describe("workspace asset prepare / read (pure)", () => {
  let dir: string;
  let ws: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-asset-gw-"));
    ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolveWorkspacePath joins root-relative paths", () => {
    expect(resolveWorkspacePath("shot.png", ws)).toBe(path.join(ws, "shot.png"));
    expect(resolveWorkspacePath("/abs/x.png")).toBe(path.normalize("/abs/x.png"));
  });

  it("mediaMimeForPath maps images and video", () => {
    expect(mediaMimeForPath("a.PNG")).toBe("image/png");
    expect(mediaMimeForPath("clip.mp4")).toBe("video/mp4");
    expect(mediaMimeForPath("notes.txt")).toBeNull();
  });

  it("prepareAsset resolves root-relative path and returns mime + size", () => {
    const file = path.join(ws, "shot.png");
    fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
    const meta = prepareWorkspaceAssetMeta("shot.png", 1024 * 1024, ws, [ws]);
    expect(meta.path).toBe(fs.realpathSync(file));
    expect(meta.name).toBe("shot.png");
    expect(meta.mime).toBe("image/png");
    expect(meta.size).toBe(4);
    expect(meta).not.toHaveProperty("dataUrl");
  });

  it("prepareAsset rejects missing files with human path", () => {
    expect(() =>
      prepareWorkspaceAssetMeta("missing.png", 1024, ws, [ws]),
    ).toThrow(/File not found/);
  });

  it("prepareAsset rejects non-media types", () => {
    const file = path.join(ws, "notes.txt");
    fs.writeFileSync(file, "hello");
    expect(() => prepareWorkspaceAssetMeta(file, undefined, undefined, [ws])).toThrow(
      /previewable/i,
    );
  });

  it("prepareAsset rejects oversized files", () => {
    const file = path.join(ws, "big.mp4");
    fs.writeFileSync(file, Buffer.alloc(100));
    expect(() => prepareWorkspaceAssetMeta(file, 10, undefined, [ws])).toThrow(
      /too large/i,
    );
  });

  it("readAsset still returns dataUrl for small images", () => {
    const file = path.join(ws, "tiny.jpg");
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff]));
    const asset = readWorkspaceAssetDataUrl(file, 1024 * 1024, undefined, [ws]);
    expect(asset.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(asset.size).toBe(3);
  });

  it("prepareAsset allows in-root absolute path", () => {
    const file = path.join(ws, "in.png");
    fs.writeFileSync(file, Buffer.from([1, 2]));
    const meta = prepareWorkspaceAssetMeta(file, 1024, undefined, [ws]);
    expect(meta.path).toBe(fs.realpathSync(file));
    expect(meta.mime).toBe("image/png");
  });

  it("prepareAsset denies out-of-root absolute path", () => {
    expect(() =>
      prepareWorkspaceAssetMeta(
        path.resolve("/etc/passwd"),
        1024,
        undefined,
        [ws],
      ),
    ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
  });

  it("prepareAsset denies path escape via .. relative to root", () => {
    expect(() =>
      prepareWorkspaceAssetMeta(
        path.join("..", "secret.png"),
        1024,
        ws,
        [ws],
      ),
    ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
  });

  it("readAsset allows in-root absolute path", () => {
    const file = path.join(ws, "ok.jpg");
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff]));
    const asset = readWorkspaceAssetDataUrl(file, 1024, undefined, [ws]);
    expect(asset.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("readAsset denies out-of-root absolute path (e.g. ~/.ssh/id_rsa)", () => {
    const outside = path.join(os.homedir(), ".ssh", "id_rsa");
    expect(() =>
      readWorkspaceAssetDataUrl(outside, 1024, undefined, [ws]),
    ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
  });

  it("readAsset denies /etc/passwd", () => {
    expect(() =>
      readWorkspaceAssetDataUrl(
        path.resolve("/etc/passwd"),
        1024,
        undefined,
        [ws],
      ),
    ).toThrow(PATH_OUTSIDE_WORKSPACE_ROOTS);
  });
});
