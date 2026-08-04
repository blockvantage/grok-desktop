import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AssetTokenStore,
  ASSET_SCHEME,
  INLINE_DATA_URL_MAX_BYTES,
  INLINE_IMAGE_MAX_BYTES,
  INLINE_VIDEO_MAX_BYTES,
  MAX_SERVE_BYTES,
  assertServableAsset,
  prefersInlineDataUrl,
  resolveAssetResponse,
} from "./asset-protocol";

describe("AssetTokenStore", () => {
  let store: AssetTokenStore;

  beforeEach(() => {
    store = new AssetTokenStore();
  });

  it("mints opaque tokens and builds scheme URLs", () => {
    const token = store.mint({
      absPath: "/tmp/ws/shot.png",
      mime: "image/png",
      size: 1200,
    });
    expect(token.length).toBeGreaterThan(10);
    expect(token).not.toContain("/");
    expect(store.buildUrl(token)).toBe(`${ASSET_SCHEME}://local/${token}`);
    expect(store.get(token)?.absPath).toBe(path.normalize("/tmp/ws/shot.png"));
  });

  it("returns undefined for unknown tokens", () => {
    expect(store.get("not-a-real-token")).toBeUndefined();
  });

  it("evicts oldest tokens when over max entries", () => {
    const small = new AssetTokenStore(2);
    const a = small.mint({ absPath: "/a.png", mime: "image/png", size: 1 });
    const b = small.mint({ absPath: "/b.png", mime: "image/png", size: 1 });
    expect(small.size).toBe(2);
    const c = small.mint({ absPath: "/c.png", mime: "image/png", size: 1 });
    expect(small.size).toBe(2);
    expect(small.get(a)).toBeUndefined();
    expect(small.get(b)?.absPath).toBe(path.normalize("/b.png"));
    expect(small.get(c)?.absPath).toBe(path.normalize("/c.png"));
  });

  it("parses tokens from request URLs", () => {
    const token = store.mint({
      absPath: "/a/b.jpg",
      mime: "image/jpeg",
      size: 10,
    });
    const url = store.buildUrl(token);
    expect(store.parseTokenFromUrl(url)).toBe(token);
    expect(store.parseTokenFromUrl("http://evil/x")).toBeNull();
    expect(store.parseTokenFromUrl(`${ASSET_SCHEME}://local/../etc`)).toBeNull();
  });
});

describe("assertServableAsset", () => {
  it("rejects relative paths", () => {
    expect(() =>
      assertServableAsset({
        absPath: "rel/shot.png",
        mime: "image/png",
        size: 10,
      }),
    ).toThrow(/absolute/i);
  });

  it("rejects missing mime", () => {
    expect(() =>
      assertServableAsset({
        absPath: "/tmp/a.bin",
        mime: "",
        size: 10,
      }),
    ).toThrow(/previewable/i);
  });

  it("rejects oversized files", () => {
    expect(() =>
      assertServableAsset({
        absPath: "/tmp/big.mp4",
        mime: "video/mp4",
        size: MAX_SERVE_BYTES + 1,
      }),
    ).toThrow(/too large/i);
  });

  it("accepts valid metadata", () => {
    expect(() =>
      assertServableAsset({
        absPath: "/Users/x/ws/out.png",
        mime: "image/png",
        size: 42,
      }),
    ).not.toThrow();
  });
});

describe("prefersInlineDataUrl", () => {
  it("inlines images and short videos under size caps", () => {
    expect(prefersInlineDataUrl("image/png", 1000)).toBe(true);
    expect(prefersInlineDataUrl("image/png", INLINE_IMAGE_MAX_BYTES)).toBe(
      true,
    );
    expect(
      prefersInlineDataUrl("image/png", INLINE_IMAGE_MAX_BYTES + 1),
    ).toBe(false);
    expect(prefersInlineDataUrl("video/mp4", 1000)).toBe(true);
    expect(prefersInlineDataUrl("video/mp4", INLINE_VIDEO_MAX_BYTES + 1)).toBe(
      false,
    );
    // legacy constant still exported
    expect(INLINE_DATA_URL_MAX_BYTES).toBeGreaterThan(0);
  });
});

describe("resolveAssetResponse", () => {
  let dir: string;
  let store: AssetTokenStore;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-asset-"));
    filePath = path.join(dir, "pic.png");
    fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    store = new AssetTokenStore();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("404s unknown tokens", () => {
    const res = resolveAssetResponse(
      store,
      `${ASSET_SCHEME}://local/nope-token-here`,
    );
    expect(res.status).toBe(404);
  });

  it("serves known tokens via file path for net.fetch", () => {
    const real = fs.realpathSync(filePath);
    const token = store.mint({
      absPath: real,
      mime: "image/png",
      size: 6,
    });
    const res = resolveAssetResponse(store, store.buildUrl(token));
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(res.absPath).toBe(real);
    expect(res.body?.kind).toBe("file");
  });

  it("returns file handle for large media (range-friendly)", () => {
    const big = path.join(dir, "big.bin");
    const size = 1024 * 1024 + 64;
    fs.writeFileSync(big, Buffer.alloc(size, 7));
    const real = fs.realpathSync(big);
    const token = store.mint({
      absPath: real,
      mime: "video/mp4",
      size,
    });
    const res = resolveAssetResponse(store, store.buildUrl(token));
    expect(res.status).toBe(200);
    expect(res.body?.kind).toBe("file");
    expect(res.absPath).toBe(real);
  });

  it("404s when file is missing after mint", () => {
    const gone = path.join(dir, "gone.png");
    fs.writeFileSync(gone, "x");
    const token = store.mint({
      absPath: fs.realpathSync(gone),
      mime: "image/png",
      size: 1,
    });
    fs.unlinkSync(gone);
    const res = resolveAssetResponse(store, store.buildUrl(token));
    expect(res.status).toBe(404);
  });

  it("404s when path is replaced with a symlink after mint", () => {
    const target = path.join(dir, "target.png");
    const outside = path.join(dir, "outside-secret.txt");
    fs.writeFileSync(target, "png");
    fs.writeFileSync(outside, "secret");
    const realTarget = fs.realpathSync(target);
    const token = store.mint({
      absPath: realTarget,
      mime: "image/png",
      size: 3,
    });
    fs.unlinkSync(target);
    fs.symlinkSync(outside, target);
    const res = resolveAssetResponse(store, store.buildUrl(token));
    expect(res.status).toBe(404);
  });
});
