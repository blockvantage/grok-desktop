/**
 * Workspace media via a privileged custom protocol.
 *
 * Renderer receives tokenized `grokdesk-asset://local/<token>` URLs. Main maps
 * tokens to absolute paths validated by the gateway; bytes never travel as
 * multi-MB base64 over JSON-lines for large/video assets.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { net, type Protocol } from "electron";

export const ASSET_SCHEME = "grokdesk-asset";

/** Prefer protocol URL above this size (still mint URL for all prepares). */
export const INLINE_DATA_URL_MAX_BYTES = 256 * 1024;

/**
 * Still inline images as data URLs up to this size so previews work even if
 * the custom protocol is blocked by CSP / session edge cases.
 */
export const INLINE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Inline short videos as data URLs when under this size (fallback path). */
export const INLINE_VIDEO_MAX_BYTES = 24 * 1024 * 1024;

/** Hard cap for files the protocol will serve. */
export const MAX_SERVE_BYTES = 256 * 1024 * 1024;

/** Above this size, serve via createReadStream instead of readFileSync. */
export const STREAM_SERVE_THRESHOLD_BYTES = 1024 * 1024;

export type AssetRecord = {
  absPath: string;
  mime: string;
  size: number;
};

/** Cap concurrent minted assets so long sessions cannot grow without bound. */
export const ASSET_TOKEN_MAX_ENTRIES = 512;

/**
 * In-memory token → path map. Opaque tokens only; renderer never sees raw FS URLs.
 * FIFO eviction when over {@link ASSET_TOKEN_MAX_ENTRIES} (Map insertion order).
 */
export class AssetTokenStore {
  private readonly map = new Map<string, AssetRecord>();
  private readonly maxEntries: number;

  constructor(maxEntries = ASSET_TOKEN_MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  mint(record: AssetRecord): string {
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    const token = randomBytes(18).toString("base64url");
    // Prefer realpath at mint so serve-time TOCTOU checks compare apples-to-apples.
    let absPath = path.normalize(record.absPath);
    try {
      if (fs.existsSync(absPath)) {
        absPath = path.normalize(fs.realpathSync(absPath));
      }
    } catch {
      // keep normalized path; serve will 404 if unresolvable
    }
    this.map.set(token, {
      absPath,
      mime: record.mime,
      size: record.size,
    });
    return token;
  }

  get(token: string): AssetRecord | undefined {
    if (!token || token.length > 128) return undefined;
    return this.map.get(token);
  }

  /** Build a renderer-safe URL for a minted token. */
  buildUrl(token: string): string {
    return `${ASSET_SCHEME}://local/${token}`;
  }

  /** Extract token from a request URL, or null if malformed. */
  parseTokenFromUrl(requestUrl: string): string | null {
    try {
      // Reject traversal before URL normalization rewrites paths.
      if (requestUrl.includes("..")) return null;
      const u = new URL(requestUrl);
      if (u.protocol !== `${ASSET_SCHEME}:`) return null;
      // host is "local"; path is "/<token>"
      const token = u.pathname.replace(/^\//, "").trim();
      // base64url tokens only
      if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
      return token;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** Shared store for the main process lifetime. */
export const assetTokenStore = new AssetTokenStore();

/**
 * Validate metadata before minting. Pure helper for unit tests.
 * Throws human-readable errors (same spirit as gateway).
 */
export function assertServableAsset(meta: {
  absPath: string;
  mime: string;
  size: number;
}): void {
  if (!meta.absPath || typeof meta.absPath !== "string") {
    throw new Error("Invalid asset path");
  }
  if (!path.isAbsolute(meta.absPath)) {
    throw new Error("Asset path must be absolute");
  }
  if (meta.absPath.includes("\0")) {
    throw new Error("Invalid asset path");
  }
  if (!meta.mime || !meta.mime.includes("/")) {
    throw new Error("Not a previewable file");
  }
  if (!Number.isFinite(meta.size) || meta.size < 0) {
    throw new Error("Invalid asset size");
  }
  if (meta.size > MAX_SERVE_BYTES) {
    throw new Error("File too large to preview");
  }
}

export type ResolvedAssetBody =
  | { kind: "buffer"; data: Buffer }
  | { kind: "stream"; stream: Readable; size: number }
  | { kind: "file"; absPath: string };

/**
 * Resolve a token to a Response body for protocol.handle.
 * Small files use a Buffer (easy for unit tests); large files stream.
 */
export function resolveAssetResponse(
  store: AssetTokenStore,
  requestUrl: string,
): {
  status: number;
  headers: Record<string, string>;
  body?: ResolvedAssetBody;
  absPath?: string;
} {
  const token = store.parseTokenFromUrl(requestUrl);
  if (!token) {
    return {
      status: 400,
      headers: { "Content-Type": "text/plain" },
      body: { kind: "buffer", data: Buffer.from("Bad request") },
    };
  }
  const rec = store.get(token);
  if (!rec) {
    return {
      status: 404,
      headers: { "Content-Type": "text/plain" },
      body: { kind: "buffer", data: Buffer.from("Unknown asset token") },
    };
  }
  // Re-resolve at serve time so a post-mint symlink swap cannot escape the
  // path that was validated when the token was minted (gateway stores realpath).
  let servePath: string;
  try {
    if (!fs.existsSync(rec.absPath)) {
      return {
        status: 404,
        headers: { "Content-Type": "text/plain" },
        body: { kind: "buffer", data: Buffer.from("File not found") },
      };
    }
    servePath = fs.realpathSync(rec.absPath);
    if (path.normalize(servePath) !== path.normalize(rec.absPath)) {
      return {
        status: 404,
        headers: { "Content-Type": "text/plain" },
        body: { kind: "buffer", data: Buffer.from("File not found") },
      };
    }
    if (!fs.statSync(servePath).isFile()) {
      return {
        status: 404,
        headers: { "Content-Type": "text/plain" },
        body: { kind: "buffer", data: Buffer.from("File not found") },
      };
    }
  } catch {
    return {
      status: 404,
      headers: { "Content-Type": "text/plain" },
      body: { kind: "buffer", data: Buffer.from("File not found") },
    };
  }
  const st = fs.statSync(servePath);
  if (st.size > MAX_SERVE_BYTES) {
    return {
      status: 413,
      headers: { "Content-Type": "text/plain" },
      body: { kind: "buffer", data: Buffer.from("File too large") },
    };
  }
  const headers = {
    "Content-Type": rec.mime,
    "Content-Length": String(st.size),
    "Cache-Control": "private, max-age=3600",
  };
  // Prefer file path so protocol.handle can net.fetch(file://) — best for
  // video range requests and avoids buffering multi-MB into JS.
  return {
    status: 200,
    headers,
    absPath: servePath,
    body: { kind: "file", absPath: servePath },
  };
}

/**
 * Register privileged scheme (must run before app.ready).
 */
export function registerAssetSchemePrivileged(
  protocol: Protocol,
): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // Avoid CSP blocking media even if index.html meta is stale in cache.
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * Attach protocol.handle after app.ready.
 * Serves validated local files via net.fetch(file://…) so Chromium handles
 * range requests for video playback.
 */
export function registerAssetProtocolHandler(
  protocol: Protocol,
  store: AssetTokenStore = assetTokenStore,
): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const resolved = resolveAssetResponse(store, request.url);
    if (resolved.absPath && resolved.status === 200) {
      try {
        // Electron-recommended pattern for serving local files to the renderer.
        return await net.fetch(pathToFileURL(resolved.absPath).href);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Prefer 404 when the path vanished or Chromium cannot open the file
        // so the renderer can show graceful "unavailable" UI instead of 500.
        // Only surface 403 for explicit permission denials; other local-read
        // failures are treated as missing (Phase 1 asset health).
        const denied = /eacces|eperm|permission denied/i.test(msg);
        if (denied) {
          return new Response(`Failed to read asset: ${msg}`, {
            status: 403,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return new Response("File not found", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }
    if (!resolved.body) {
      return new Response(null, {
        status: resolved.status,
        headers: resolved.headers,
      });
    }
    if (resolved.body.kind === "buffer") {
      return new Response(new Uint8Array(resolved.body.data), {
        status: resolved.status,
        headers: resolved.headers,
      });
    }
    if (resolved.body.kind === "stream") {
      const webStream = Readable.toWeb(
        resolved.body.stream,
      ) as ReadableStream;
      return new Response(webStream, {
        status: resolved.status,
        headers: resolved.headers,
      });
    }
    // file kind without absPath fallthrough
    return new Response("Not found", { status: 404 });
  });
}

/** Whether a mime should prefer inline data URL when small. */
export function prefersInlineDataUrl(mime: string, size: number): boolean {
  if (mime.startsWith("image/")) {
    return size <= INLINE_IMAGE_MAX_BYTES;
  }
  if (mime.startsWith("video/")) {
    return size <= INLINE_VIDEO_MAX_BYTES;
  }
  return size <= INLINE_DATA_URL_MAX_BYTES;
}
