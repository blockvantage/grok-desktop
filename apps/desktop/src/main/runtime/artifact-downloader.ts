/**
 * Safe streaming download of managed Grok runtime artifacts.
 *
 * - Streams to `.part` + metadata with user-only permissions (no full buffer).
 * - Aborts at expectedSize + 1; verifies exact length and SHA-256.
 * - Resumes only when artifact ID, SHA, length, ETag, and source host match;
 *   requires a valid 206 + exact Content-Range. Otherwise restarts at byte 0.
 * - Follows at most three redirects within a signed host allowlist.
 * - Never sends entitlement auth headers across an origin change.
 */
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const PART_META_SCHEMA_VERSION = 1 as const;

export type PartMetadata = {
  schemaVersion: typeof PART_META_SCHEMA_VERSION;
  artifactId: string;
  expectedSha256: string;
  expectedSize: number;
  etag?: string;
  sourceHost: string;
  sourceUrl: string;
  bytesWritten: number;
};

export type ArtifactDownloadRequest = {
  artifactId: string;
  /** Opaque storage URL (post-grant). HTTPS required unless `allowHttp`. */
  url: string;
  expectedSize: number;
  /** Lowercase or mixed hex SHA-256 of the final artifact bytes. */
  expectedSha256: string;
  /** Exact hostname allowlist for the initial URL and every redirect hop. */
  allowedHosts: readonly string[];
  /** Destination directory (typically under `runtimes/grok/staging/...`). */
  destDir: string;
  /** Final file name after successful download. Default: `artifact`. */
  fileName?: string;
};

export type ArtifactDownloadProgress = {
  bytesReceived: number;
  expectedSize: number;
};

export type ArtifactDownloadOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Wall-clock timeout for the entire download attempt. Default 120_000. */
  timeoutMs?: number;
  /** Max redirect hops. Default 3. */
  maxRedirects?: number;
  /**
   * Auth headers applied only while the request origin matches the first hop.
   * Stripped on cross-origin redirects (grant → CDN).
   */
  authHeaders?: Record<string, string>;
  onProgress?: (progress: ArtifactDownloadProgress) => void;
  /** Allow `http://` (tests / local fixtures). Default false. */
  allowHttp?: boolean;
  /** When set, digest-mismatch payloads are moved here instead of deleted. */
  quarantineDir?: string;
  /**
   * Test hook: replace the per-chunk disk write. Throw with `code: "ENOSPC"`
   * to exercise disk-full handling.
   */
  writeChunk?: (fd: number, chunk: Buffer) => void;
};

export type ArtifactDownloadErrorCode =
  | "invalid_url"
  | "host_not_allowed"
  | "redirect_not_allowed"
  | "too_many_redirects"
  | "http_error"
  | "timeout"
  | "cancelled"
  | "size_overrun"
  | "size_underrun"
  | "digest_mismatch"
  | "disk_full"
  | "network_error"
  | "range_invalid"
  | "incomplete"
  | "invalid_request";

export type ArtifactDownloadResult =
  | {
      ok: true;
      path: string;
      sha256: string;
      sizeBytes: number;
      etag?: string;
      resumed: boolean;
    }
  | {
      ok: false;
      code: ArtifactDownloadErrorCode;
      message: string;
    };

function isSha256Hex(v: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(v);
}

function normalizeSha(hex: string): string {
  return hex.toLowerCase();
}

export function partFilePath(destDir: string, fileName: string): string {
  return path.join(destDir, `${fileName}.part`);
}

export function partMetaPath(destDir: string, fileName: string): string {
  return path.join(destDir, `${fileName}.part.meta.json`);
}

export function finalArtifactPath(destDir: string, fileName: string): string {
  return path.join(destDir, fileName);
}

export function loadPartMetadata(metaPath: string): PartMetadata | null {
  if (!existsSync(metaPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== PART_META_SCHEMA_VERSION) return null;
  if (
    typeof o.artifactId !== "string" ||
    o.artifactId.length === 0 ||
    typeof o.expectedSha256 !== "string" ||
    !isSha256Hex(o.expectedSha256) ||
    typeof o.expectedSize !== "number" ||
    !Number.isInteger(o.expectedSize) ||
    o.expectedSize < 0 ||
    typeof o.sourceHost !== "string" ||
    o.sourceHost.length === 0 ||
    typeof o.sourceUrl !== "string" ||
    o.sourceUrl.length === 0 ||
    typeof o.bytesWritten !== "number" ||
    !Number.isInteger(o.bytesWritten) ||
    o.bytesWritten < 0
  ) {
    return null;
  }
  if (o.etag !== undefined && typeof o.etag !== "string") return null;
  return {
    schemaVersion: PART_META_SCHEMA_VERSION,
    artifactId: o.artifactId,
    expectedSha256: normalizeSha(o.expectedSha256),
    expectedSize: o.expectedSize,
    ...(typeof o.etag === "string" ? { etag: o.etag } : {}),
    sourceHost: o.sourceHost,
    sourceUrl: o.sourceUrl,
    bytesWritten: o.bytesWritten,
  };
}

function writePartMetadata(metaPath: string, meta: PartMetadata): void {
  const dir = path.dirname(metaPath);
  mkdirUserOnly(dir);
  const tmp = path.join(
    dir,
    `.${path.basename(metaPath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(meta)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* Windows */
  }
  try {
    renameSync(tmp, metaPath);
  } catch {
    try {
      unlinkSync(metaPath);
    } catch {
      /* absent */
    }
    renameSync(tmp, metaPath);
  }
}

function mkdirUserOnly(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* Windows */
  }
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => a.toLowerCase() === h);
}

function parseUrl(
  raw: string,
  allowHttp: boolean,
): { ok: true; url: URL } | { ok: false; code: "invalid_url"; message: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalid_url", message: "URL is not absolute" };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      code: "invalid_url",
      message: "URL must not include credentials",
    };
  }
  if (url.protocol === "https:") return { ok: true, url };
  if (url.protocol === "http:" && allowHttp) return { ok: true, url };
  return {
    ok: false,
    code: "invalid_url",
    message:
      url.protocol === "http:"
        ? "HTTP URLs require allowHttp"
        : `Unsupported URL scheme: ${url.protocol}`,
  };
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function parseContentRange(
  header: string | null,
): { start: number; end: number; total: number } | null {
  if (!header) return null;
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (m[3] === "*") return null;
  const total = Number(m[3]);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    !Number.isInteger(total) ||
    start < 0 ||
    end < start ||
    total <= 0
  ) {
    return null;
  }
  return { start, end, total };
}

function isEnospc(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOSPC"
  );
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: string }).code;
  return name === "AbortError" || code === "ABORT_ERR";
}

function deleteQuiet(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best-effort */
  }
}

function removePartial(destDir: string, fileName: string): void {
  deleteQuiet(partFilePath(destDir, fileName));
  deleteQuiet(partMetaPath(destDir, fileName));
}

function quarantinePartial(
  partPath: string,
  quarantine: string | undefined,
  artifactId: string,
): void {
  if (!existsSync(partPath)) return;
  if (!quarantine) {
    deleteQuiet(partPath);
    return;
  }
  try {
    mkdirUserOnly(quarantine);
    const dest = path.join(
      quarantine,
      `${artifactId}-${Date.now()}-${randomBytes(4).toString("hex")}.bin`,
    );
    renameSync(partPath, dest);
  } catch {
    deleteQuiet(partPath);
  }
}

/**
 * Decide whether an on-disk partial can be resumed for this request.
 */
export function canResumePartial(
  request: ArtifactDownloadRequest,
  meta: PartMetadata | null,
  partPath: string,
): meta is PartMetadata {
  if (!meta) return false;
  if (!existsSync(partPath)) return false;
  let st: { size: number };
  try {
    st = statSync(partPath);
  } catch {
    return false;
  }
  if (st.size !== meta.bytesWritten) return false;
  if (meta.bytesWritten <= 0) return false;
  if (meta.bytesWritten >= request.expectedSize) return false;
  if (meta.artifactId !== request.artifactId) return false;
  if (
    normalizeSha(meta.expectedSha256) !== normalizeSha(request.expectedSha256)
  ) {
    return false;
  }
  if (meta.expectedSize !== request.expectedSize) return false;
  let requestHost: string;
  try {
    requestHost = new URL(request.url).hostname;
  } catch {
    return false;
  }
  if (meta.sourceHost.toLowerCase() !== requestHost.toLowerCase()) return false;
  try {
    const metaHost = new URL(meta.sourceUrl).hostname;
    if (metaHost.toLowerCase() !== requestHost.toLowerCase()) return false;
  } catch {
    return false;
  }
  return true;
}

async function sha256FileStreaming(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk as Buffer);
    }
  });
  return hash.digest("hex");
}

async function drainBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    /* ignore */
  }
}

/**
 * Fetch following redirects manually so we can enforce host allowlist and
 * strip auth on origin change.
 */
async function fetchWithRedirectPolicy(
  initialUrl: URL,
  options: {
    fetchImpl: typeof fetch;
    allowHttp: boolean;
    allowedHosts: readonly string[];
    maxRedirects: number;
    authHeaders?: Record<string, string>;
    rangeStart?: number;
    signal?: AbortSignal;
  },
): Promise<
  | { ok: true; response: Response; finalUrl: URL }
  | { ok: false; code: ArtifactDownloadErrorCode; message: string }
> {
  let current = initialUrl;
  const originalOrigin = new URL(initialUrl.href);
  let redirects = 0;

  for (;;) {
    if (!hostAllowed(current.hostname, options.allowedHosts)) {
      return {
        ok: false,
        code: redirects === 0 ? "host_not_allowed" : "redirect_not_allowed",
        message: `Host not on allowlist: ${current.hostname}`,
      };
    }

    const headers: Record<string, string> = {
      Accept: "application/octet-stream",
    };
    if (options.rangeStart !== undefined && options.rangeStart > 0) {
      headers.Range = `bytes=${options.rangeStart}-`;
    }
    if (options.authHeaders && sameOrigin(current, originalOrigin)) {
      Object.assign(headers, options.authHeaders);
    }

    let response: Response;
    try {
      response = await options.fetchImpl(current.href, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: options.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        return { ok: false, code: "cancelled", message: "Download cancelled" };
      }
      return {
        ok: false,
        code: "network_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (isRedirectStatus(response.status)) {
      const loc = response.headers.get("location");
      if (!loc) {
        return {
          ok: false,
          code: "http_error",
          message: `Redirect ${response.status} without Location`,
        };
      }
      redirects += 1;
      if (redirects > options.maxRedirects) {
        await drainBody(response);
        return {
          ok: false,
          code: "too_many_redirects",
          message: `Exceeded max redirects (${options.maxRedirects})`,
        };
      }
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return {
          ok: false,
          code: "invalid_url",
          message: `Invalid redirect Location: ${loc}`,
        };
      }
      const parsed = parseUrl(next.href, options.allowHttp);
      if (!parsed.ok) {
        return { ok: false, code: parsed.code, message: parsed.message };
      }
      if (!hostAllowed(parsed.url.hostname, options.allowedHosts)) {
        await drainBody(response);
        return {
          ok: false,
          code: "redirect_not_allowed",
          message: `Redirect host not on allowlist: ${parsed.url.hostname}`,
        };
      }
      await drainBody(response);
      current = parsed.url;
      continue;
    }

    return { ok: true, response, finalUrl: current };
  }
}

async function streamToPart(args: {
  response: Response;
  partPath: string;
  expectedSize: number;
  resumeFrom: number;
  append: boolean;
  signal?: AbortSignal;
  onProgress?: (p: ArtifactDownloadProgress) => void;
  writeChunk?: (fd: number, chunk: Buffer) => void;
}): Promise<
  | { ok: true; bytesWritten: number }
  | { ok: false; code: ArtifactDownloadErrorCode; message: string }
> {
  const body = args.response.body;
  if (!body) {
    return { ok: false, code: "network_error", message: "Empty response body" };
  }

  mkdirUserOnly(path.dirname(args.partPath));

  let bytesOnDisk = args.resumeFrom;
  let fd: number | null = null;

  const defaultWrite = (fileFd: number, chunk: Buffer): void => {
    writeFileSync(fileFd, chunk);
  };
  const writeChunk = args.writeChunk ?? defaultWrite;

  try {
    fd = openSync(args.partPath, args.append ? "a" : "w", 0o600);
    try {
      chmodSync(args.partPath, 0o600);
    } catch {
      /* Windows */
    }

    const reader = body.getReader();
    for (;;) {
      if (args.signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return { ok: false, code: "cancelled", message: "Download cancelled" };
      }
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
        if (isAbortError(err) || args.signal?.aborted) {
          return { ok: false, code: "cancelled", message: "Download cancelled" };
        }
        return {
          ok: false,
          code: "network_error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
      const { done, value } = readResult;
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const chunk = Buffer.from(value);

      if (bytesOnDisk + chunk.byteLength > args.expectedSize) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return {
          ok: false,
          code: "size_overrun",
          message: `Received more than expectedSize (${args.expectedSize})`,
        };
      }

      try {
        writeChunk(fd, chunk);
      } catch (err) {
        if (isEnospc(err)) {
          return {
            ok: false,
            code: "disk_full",
            message: "No space left on device",
          };
        }
        return {
          ok: false,
          code: "network_error",
          message: err instanceof Error ? err.message : String(err),
        };
      }

      bytesOnDisk += chunk.byteLength;
      args.onProgress?.({
        bytesReceived: bytesOnDisk,
        expectedSize: args.expectedSize,
      });
    }

    try {
      fsyncSync(fd);
    } catch {
      /* best-effort */
    }

    if (bytesOnDisk < args.expectedSize) {
      return {
        ok: false,
        code: "size_underrun",
        message: `Received ${bytesOnDisk} of ${args.expectedSize} bytes`,
      };
    }
    if (bytesOnDisk > args.expectedSize) {
      return {
        ok: false,
        code: "size_overrun",
        message: `Received ${bytesOnDisk} of ${args.expectedSize} bytes`,
      };
    }

    return { ok: true, bytesWritten: bytesOnDisk };
  } catch (err) {
    if (isAbortError(err) || args.signal?.aborted) {
      return { ok: false, code: "cancelled", message: "Download cancelled" };
    }
    if (isEnospc(err)) {
      return {
        ok: false,
        code: "disk_full",
        message: "No space left on device",
      };
    }
    return {
      ok: false,
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function persistResumeMeta(
  metaPath: string,
  request: ArtifactDownloadRequest,
  sourceHost: string,
  bytesWritten: number,
  etag?: string | null,
): void {
  writePartMetadata(metaPath, {
    schemaVersion: PART_META_SCHEMA_VERSION,
    artifactId: request.artifactId,
    expectedSha256: normalizeSha(request.expectedSha256),
    expectedSize: request.expectedSize,
    ...(etag ? { etag } : {}),
    sourceHost,
    sourceUrl: request.url,
    bytesWritten,
  });
}

/**
 * Download a runtime artifact with size + SHA-256 verification and bounded resume.
 */
export async function downloadArtifact(
  request: ArtifactDownloadRequest,
  options: ArtifactDownloadOptions = {},
): Promise<ArtifactDownloadResult> {
  const fileName = request.fileName ?? "artifact";
  const allowHttp = options.allowHttp === true;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (
    !request.artifactId ||
    typeof request.expectedSize !== "number" ||
    !Number.isInteger(request.expectedSize) ||
    request.expectedSize < 0 ||
    !isSha256Hex(request.expectedSha256)
  ) {
    return {
      ok: false,
      code: "invalid_request",
      message: "Invalid download request fields",
    };
  }

  const parsed = parseUrl(request.url, allowHttp);
  if (!parsed.ok) {
    return { ok: false, code: parsed.code, message: parsed.message };
  }
  if (!hostAllowed(parsed.url.hostname, request.allowedHosts)) {
    return {
      ok: false,
      code: "host_not_allowed",
      message: `Host not on allowlist: ${parsed.url.hostname}`,
    };
  }

  mkdirUserOnly(request.destDir);
  const partPath = partFilePath(request.destDir, fileName);
  const metaPath = partMetaPath(request.destDir, fileName);
  const finalPath = finalArtifactPath(request.destDir, fileName);
  const sourceHost = parsed.url.hostname;

  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = (): void => {
    controller.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) {
      return { ok: false, code: "cancelled", message: "Download cancelled" };
    }
    options.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const wallTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const mapAbort = (
    code: ArtifactDownloadErrorCode,
  ): ArtifactDownloadErrorCode => {
    if (code === "cancelled" && timedOut) return "timeout";
    if (timedOut && code === "network_error") return "timeout";
    return code;
  };

  const fail = (
    code: ArtifactDownloadErrorCode,
    message: string,
    opts?: { keepPartial?: boolean; quarantine?: boolean },
  ): ArtifactDownloadResult => {
    if (opts?.quarantine) {
      quarantinePartial(partPath, options.quarantineDir, request.artifactId);
      deleteQuiet(metaPath);
    } else if (!opts?.keepPartial) {
      removePartial(request.destDir, fileName);
    }
    return { ok: false, code: mapAbort(code), message };
  };

  try {
    // At most two attempts: one resume (if eligible), one full restart.
    let forceRestart = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted) {
        return fail(
          timedOut ? "timeout" : "cancelled",
          timedOut ? "Download timed out" : "Download cancelled",
          { keepPartial: true },
        );
      }

      let resumeFrom = 0;
      let resumed = false;
      let meta = forceRestart ? null : loadPartMetadata(metaPath);

      if (!forceRestart && canResumePartial(request, meta, partPath)) {
        resumeFrom = meta!.bytesWritten;
        resumed = true;
      } else {
        removePartial(request.destDir, fileName);
        meta = null;
        resumeFrom = 0;
        resumed = false;
      }

      const fetched = await fetchWithRedirectPolicy(parsed.url, {
        fetchImpl,
        allowHttp,
        allowedHosts: request.allowedHosts,
        maxRedirects,
        authHeaders: options.authHeaders,
        rangeStart: resumeFrom > 0 ? resumeFrom : undefined,
        signal: controller.signal,
      });

      if (!fetched.ok) {
        const keep =
          fetched.code === "cancelled" ||
          fetched.code === "network_error" ||
          (resumeFrom > 0 && existsSync(partPath));
        return fail(fetched.code, fetched.message, {
          keepPartial: keep && existsSync(partPath),
        });
      }

      const { response } = fetched;
      const etag = response.headers.get("etag") ?? meta?.etag ?? undefined;

      if (resumeFrom > 0) {
        if (response.status === 206) {
          const cr = parseContentRange(response.headers.get("content-range"));
          if (
            !cr ||
            cr.start !== resumeFrom ||
            cr.total !== request.expectedSize ||
            cr.end !== request.expectedSize - 1
          ) {
            await drainBody(response);
            removePartial(request.destDir, fileName);
            forceRestart = true;
            // One automatic restart only.
            if (attempt === 0) continue;
            return fail(
              "range_invalid",
              "Invalid Content-Range on 206 response",
            );
          }
          if (meta?.etag && etag && meta.etag !== etag) {
            await drainBody(response);
            removePartial(request.destDir, fileName);
            forceRestart = true;
            if (attempt === 0) continue;
            return fail(
              "range_invalid",
              "ETag changed during resume",
            );
          }
        } else if (response.status === 200) {
          // Server ignored Range — full body restart.
          removePartial(request.destDir, fileName);
          resumeFrom = 0;
          resumed = false;
        } else {
          await drainBody(response);
          return fail(
            "http_error",
            `Unexpected status ${response.status} on ranged request`,
          );
        }
      } else if (response.status === 206) {
        await drainBody(response);
        return fail("range_invalid", "Unexpected 206 without Range request");
      } else if (response.status !== 200) {
        await drainBody(response);
        return fail(
          "http_error",
          `Unexpected HTTP status ${response.status}`,
        );
      }

      persistResumeMeta(metaPath, request, sourceHost, resumeFrom, etag);

      const streamed = await streamToPart({
        response,
        partPath,
        expectedSize: request.expectedSize,
        resumeFrom,
        append: resumeFrom > 0,
        signal: controller.signal,
        onProgress: options.onProgress,
        writeChunk: options.writeChunk,
      });

      if (!streamed.ok) {
        const keepable =
          streamed.code === "size_underrun" ||
          streamed.code === "cancelled" ||
          streamed.code === "network_error";
        if (keepable && existsSync(partPath)) {
          let size = 0;
          try {
            size = statSync(partPath).size;
          } catch {
            size = 0;
          }
          if (size > 0 && size < request.expectedSize) {
            persistResumeMeta(metaPath, request, sourceHost, size, etag);
            return fail(streamed.code, streamed.message, {
              keepPartial: true,
            });
          }
        }
        return fail(streamed.code, streamed.message, { keepPartial: false });
      }

      const digest = await sha256FileStreaming(partPath);
      if (digest !== normalizeSha(request.expectedSha256)) {
        return fail("digest_mismatch", "SHA-256 mismatch", {
          quarantine: true,
        });
      }

      try {
        if (existsSync(finalPath)) {
          unlinkSync(finalPath);
        }
        renameSync(partPath, finalPath);
      } catch (err) {
        return fail(
          "network_error",
          `Failed to finalize artifact: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      try {
        chmodSync(finalPath, 0o600);
      } catch {
        /* Windows */
      }
      deleteQuiet(metaPath);

      try {
        const fd = openSync(finalPath, "r");
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      } catch {
        /* ignore */
      }

      return {
        ok: true,
        path: finalPath,
        sha256: digest,
        sizeBytes: request.expectedSize,
        ...(etag ? { etag } : {}),
        resumed,
      };
    }

    return fail("incomplete", "Download attempts exhausted");
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      return fail(
        timedOut ? "timeout" : "cancelled",
        timedOut ? "Download timed out" : "Download cancelled",
        { keepPartial: true },
      );
    }
    return fail(
      "network_error",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(wallTimer);
    if (options.signal) {
      options.signal.removeEventListener("abort", onCallerAbort);
    }
  }
}
