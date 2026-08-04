/**
 * Fetch signed release manifests over HTTPS with ETag/304, offline cache
 * fallback, size limits, and strict URL policy (no packaged local fixtures).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CompatibilityManifestPayload,
  SignedCompatibilityEnvelope,
} from "@grokdesk/shared";
import { ManifestCache, type ManifestCacheRecord } from "./manifest-cache.js";
import {
  verifySignedCompatibilityManifest,
  type ManifestVerifyErrorCode,
  type ManifestVerifySuccess,
  type ReleaseKeyRing,
} from "./manifest-verifier.js";

/** Default max body size for a release manifest envelope (1 MiB). */
export const DEFAULT_MANIFEST_MAX_BYTES = 1 * 1024 * 1024;

/** Wall-clock timeout for the HTTPS manifest GET. */
export const DEFAULT_MANIFEST_FETCH_TIMEOUT_MS = 15_000;

export type ManifestClientEnv = {
  /** True when the app is a packaged Electron build. */
  isPackaged: boolean;
  /**
   * Explicit test/dev flag allowing local file fixtures when unpackaged.
   * Never honored when `isPackaged` is true.
   */
  allowDevFixtureUrls?: boolean;
};

export type ManifestFetchOptions = {
  url: string;
  keys: ReleaseKeyRing;
  cache: ManifestCache;
  env: ManifestClientEnv;
  nowMs?: number;
  maxBytes?: number;
  requiredTarget?: string;
  requiredPairId?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock. */
  clock?: () => number;
  /** Wall-clock timeout for the HTTP fetch. Default {@link DEFAULT_MANIFEST_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Optional caller abort. Composed with the wall-clock timeout — never
   * replaces a caller signal; both can abort the request.
   */
  signal?: AbortSignal;
};

export type ManifestFetchErrorCode =
  | ManifestVerifyErrorCode
  | "invalid_url"
  | "local_file_rejected"
  | "oversized_response"
  | "http_error"
  | "network_error"
  | "invalid_body"
  | "cache_corrupt"
  | "offline_no_cache";

export type ManifestFetchResult =
  | {
      ok: true;
      source: "network" | "not_modified" | "cache" | "fixture";
      payload: CompatibilityManifestPayload;
      envelope: SignedCompatibilityEnvelope;
      acceptedKeyId: string;
      payloadSha256: string;
      sequence: number;
      etag?: string;
      checkedAt: string;
    }
  | {
      ok: false;
      code: ManifestFetchErrorCode;
      message: string;
    };

function isHttpUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

function isLocalFileUrl(url: URL): boolean {
  return url.protocol === "file:";
}

function looksLikeFilesystemPath(raw: string): boolean {
  if (raw.startsWith("file:")) return false;
  if (path.isAbsolute(raw)) return true;
  // Relative fixture paths (dev only).
  return (
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(raw)
  );
}

/**
 * Resolve and authorize the manifest URL.
 * Packaged builds accept only http(s). Dev fixtures require !packaged + flag.
 */
export function resolveManifestUrl(
  raw: string,
  env: ManifestClientEnv,
):
  | { ok: true; kind: "http"; url: string }
  | { ok: true; kind: "file"; path: string }
  | { ok: false; code: "invalid_url" | "local_file_rejected"; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, code: "invalid_url", message: "Manifest URL is empty" };
  }

  if (looksLikeFilesystemPath(trimmed) || trimmed.startsWith("file:")) {
    if (env.isPackaged || !env.allowDevFixtureUrls) {
      return {
        ok: false,
        code: "local_file_rejected",
        message:
          "Local manifest fixtures are only allowed when unpackaged with an explicit test flag",
      };
    }
    try {
      const filePath = trimmed.startsWith("file:")
        ? pathFromFileUrl(trimmed)
        : path.resolve(trimmed);
      return { ok: true, kind: "file", path: filePath };
    } catch {
      return {
        ok: false,
        code: "invalid_url",
        message: "Local manifest path is invalid",
      };
    }
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      code: "invalid_url",
      message: "Manifest URL is not a valid absolute URL",
    };
  }

  if (isLocalFileUrl(url)) {
    if (env.isPackaged || !env.allowDevFixtureUrls) {
      return {
        ok: false,
        code: "local_file_rejected",
        message:
          "Local manifest fixtures are only allowed when unpackaged with an explicit test flag",
      };
    }
    return { ok: true, kind: "file", path: pathFromFileUrl(url.href) };
  }

  if (!isHttpUrl(url)) {
    return {
      ok: false,
      code: "invalid_url",
      message: `Unsupported manifest URL scheme: ${url.protocol}`,
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      code: "invalid_url",
      message: "Manifest URL must not include credentials",
    };
  }

  // Packaged builds require HTTPS only.
  if (env.isPackaged && url.protocol !== "https:") {
    return {
      ok: false,
      code: "invalid_url",
      message: "Packaged builds require HTTPS manifest URLs",
    };
  }

  return { ok: true, kind: "http", url: url.href };
}

function pathFromFileUrl(href: string): string {
  const u = new URL(href);
  if (u.protocol !== "file:") throw new Error("not_file");
  // Node pathFromFileURL equivalent without importing for older targets.
  let p = decodeURIComponent(u.pathname);
  if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(p)) {
    p = p.slice(1);
  }
  return path.normalize(p);
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<
  | { ok: true; text: string }
  | { ok: false; code: "oversized_response"; message: string }
> {
  const cl = response.headers.get("content-length");
  if (cl != null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) {
      return {
        ok: false,
        code: "oversized_response",
        message: `Manifest Content-Length ${n} exceeds limit ${maxBytes}`,
      };
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      return {
        ok: false,
        code: "oversized_response",
        message: `Manifest body exceeds limit ${maxBytes}`,
      };
    }
    return { ok: true, text };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        code: "oversized_response",
        message: `Manifest body exceeds limit ${maxBytes}`,
      };
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { ok: true, text: buf.toString("utf8") };
}

function antiRollbackFromCache(
  cacheLoad: ReturnType<ManifestCache["load"]>,
): {
  highestSequenceSeen?: number;
  highestSequencePayloadSha256?: string;
  etag?: string;
} {
  if (!cacheLoad.ok) return {};
  return {
    highestSequenceSeen: cacheLoad.record.highestSequence,
    highestSequencePayloadSha256: cacheLoad.record.payloadSha256,
    etag: cacheLoad.record.etag,
  };
}

function successFromVerify(
  verified: ManifestVerifySuccess,
  source: Extract<ManifestFetchResult, { ok: true }>["source"],
  checkedAt: string,
  etag?: string,
): Extract<ManifestFetchResult, { ok: true }> {
  return {
    ok: true,
    source,
    payload: verified.payload,
    envelope: verified.envelope,
    acceptedKeyId: verified.acceptedKeyId,
    payloadSha256: verified.payloadSha256,
    sequence: verified.sequence,
    ...(etag ? { etag } : {}),
    checkedAt,
  };
}

function persistVerified(
  cache: ManifestCache,
  verified: ManifestVerifySuccess,
  checkedAt: string,
  etag?: string,
): void {
  const record: ManifestCacheRecord = {
    envelope: verified.envelope,
    payloadSha256: verified.payloadSha256,
    highestSequence: verified.sequence,
    checkedAt,
    ...(etag ? { etag } : {}),
  };
  cache.store(record);
}

/**
 * Fetch (or load fixture/cache) a signed compatibility manifest.
 */
export async function fetchReleaseManifest(
  options: ManifestFetchOptions,
): Promise<ManifestFetchResult> {
  const nowMs = options.nowMs ?? options.clock?.() ?? Date.now();
  const checkedAt = new Date(nowMs).toISOString();
  const maxBytes = options.maxBytes ?? DEFAULT_MANIFEST_MAX_BYTES;
  const resolved = resolveManifestUrl(options.url, options.env);
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, message: resolved.message };
  }

  const cacheLoad = options.cache.load();
  const anti = antiRollbackFromCache(cacheLoad);

  const verifyOpts = {
    keys: options.keys,
    nowMs,
    highestSequenceSeen: anti.highestSequenceSeen,
    highestSequencePayloadSha256: anti.highestSequencePayloadSha256,
    requiredTarget: options.requiredTarget,
    requiredPairId: options.requiredPairId,
  };

  if (resolved.kind === "file") {
    let text: string;
    try {
      text = await readFile(resolved.path, "utf8");
    } catch (err) {
      return {
        ok: false,
        code: "network_error",
        message: `Failed to read fixture: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      return {
        ok: false,
        code: "oversized_response",
        message: `Manifest body exceeds limit ${maxBytes}`,
      };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return {
        ok: false,
        code: "invalid_body",
        message: "Manifest fixture is not valid JSON",
      };
    }
    const verified = verifySignedCompatibilityManifest(body, verifyOpts);
    if (!verified.ok) {
      return { ok: false, code: verified.code, message: verified.message };
    }
    persistVerified(options.cache, verified, checkedAt);
    return successFromVerify(verified, "fixture", checkedAt);
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MANIFEST_FETCH_TIMEOUT_MS;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (anti.etag) {
    headers["If-None-Match"] = anti.etag;
  }

  const controller = new AbortController();
  const onCallerAbort = (): void => {
    controller.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) {
      return offlineOrError(
        cacheLoad,
        verifyOpts,
        checkedAt,
        new Error("aborted"),
      );
    }
    options.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const wallTimer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(resolved.url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });
  } catch (err) {
    return offlineOrError(cacheLoad, verifyOpts, checkedAt, err);
  } finally {
    clearTimeout(wallTimer);
    if (options.signal) {
      options.signal.removeEventListener("abort", onCallerAbort);
    }
  }

  if (response.status === 304) {
    if (!cacheLoad.ok) {
      return {
        ok: false,
        code: "cache_corrupt",
        message: "HTTP 304 but no valid cached manifest",
      };
    }
    const verified = verifySignedCompatibilityManifest(
      cacheLoad.record.envelope,
      {
        ...verifyOpts,
        // Re-validating the same envelope: same sequence + same hash must pass.
        highestSequenceSeen: cacheLoad.record.highestSequence,
        highestSequencePayloadSha256: cacheLoad.record.payloadSha256,
      },
    );
    if (!verified.ok) {
      return { ok: false, code: verified.code, message: verified.message };
    }
    const etag = cacheLoad.record.etag;
    persistVerified(options.cache, verified, checkedAt, etag);
    return successFromVerify(verified, "not_modified", checkedAt, etag);
  }

  if (!response.ok) {
    // Prefer offline cache for transient server errors when still valid.
    if (response.status >= 500 || response.status === 429) {
      const offline = tryOfflineCache(cacheLoad, verifyOpts, checkedAt);
      if (offline) return offline;
    }
    return {
      ok: false,
      code: "http_error",
      message: `Manifest HTTP ${response.status}`,
    };
  }

  const bodyResult = await readBodyWithLimit(response, maxBytes);
  if (!bodyResult.ok) {
    return {
      ok: false,
      code: bodyResult.code,
      message: bodyResult.message,
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text);
  } catch {
    return {
      ok: false,
      code: "invalid_body",
      message: "Manifest response is not valid JSON",
    };
  }

  const verified = verifySignedCompatibilityManifest(body, verifyOpts);
  if (!verified.ok) {
    return { ok: false, code: verified.code, message: verified.message };
  }

  const etag = response.headers.get("etag") ?? undefined;
  persistVerified(options.cache, verified, checkedAt, etag);
  return successFromVerify(verified, "network", checkedAt, etag);
}

function tryOfflineCache(
  cacheLoad: ReturnType<ManifestCache["load"]>,
  verifyOpts: Parameters<typeof verifySignedCompatibilityManifest>[1],
  checkedAt: string,
): Extract<ManifestFetchResult, { ok: true }> | null {
  if (!cacheLoad.ok) return null;
  const verified = verifySignedCompatibilityManifest(cacheLoad.record.envelope, {
    ...verifyOpts,
    highestSequenceSeen: cacheLoad.record.highestSequence,
    highestSequencePayloadSha256: cacheLoad.record.payloadSha256,
  });
  if (!verified.ok) return null;
  return successFromVerify(
    verified,
    "cache",
    checkedAt,
    cacheLoad.record.etag,
  );
}

function offlineOrError(
  cacheLoad: ReturnType<ManifestCache["load"]>,
  verifyOpts: Parameters<typeof verifySignedCompatibilityManifest>[1],
  checkedAt: string,
  err: unknown,
): ManifestFetchResult {
  const offline = tryOfflineCache(cacheLoad, verifyOpts, checkedAt);
  if (offline) return offline;
  if (cacheLoad.ok === false && cacheLoad.code === "corrupt") {
    return {
      ok: false,
      code: "cache_corrupt",
      message: cacheLoad.message,
    };
  }
  return {
    ok: false,
    code: cacheLoad.ok ? "offline_no_cache" : "network_error",
    message: `Network unavailable and no valid cache: ${
      err instanceof Error ? err.message : String(err)
    }`,
  };
}

/** Build a file:// URL for a local path (tests / unpackaged fixtures). */
export function fixtureUrlFromPath(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).href;
}
