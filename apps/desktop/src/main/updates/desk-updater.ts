/**
 * Narrow electron-updater wrapper for exact Desk version installs.
 *
 * Public surface only:
 * - downloadExact
 * - installOnRestart
 * - cancelDownload
 * - safe progress events
 *
 * Never selects generic "latest". Automatic install-on-quit stays disabled
 * until the coordinator authorizes installOnRestart. Downloaded artifacts
 * must match the signed compatibility manifest (SHA-256) before install.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { finished } from "node:stream/promises";

/** Exact Desk release feed returned for one resolved pair. */
export type ExactDeskFeed = {
  /** Exact SemVer of the Desk release (must match resolved pair). */
  version: string;
  /**
   * Protected short-lived feed base URL (HTTPS). Must not be a generic
   * public "latest" channel without version binding.
   */
  feedUrl: string;
  /** Artifact id from the signed compatibility manifest. */
  artifactId: string;
  /** Manifest SHA-256 (hex) of the Desk installer/zip. */
  sha256: string;
  /** Optional electron-updater blockmap SHA-512 (base64 or hex). */
  sha512?: string;
  sizeBytes: number;
  /** True only when the signed resolver authorized this Desk downgrade. */
  allowDowngrade?: boolean;
  /** Optional grant id (never logged; not stored in journals). */
  grantId?: string;
};

export type DeskDownloadProgress = {
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
};

export type DeskDownloadResult =
  | {
      ok: true;
      version: string;
      artifactId: string;
      sha256: string;
      sizeBytes: number;
      /** Concrete local installer path verified against the manifest. */
      path: string;
    }
  | {
      ok: false;
      code:
        | "invalid_feed"
        | "version_mismatch"
        | "digest_mismatch"
        | "size_mismatch"
        | "download_failed"
        | "cancelled"
        | "busy"
        | "not_downloaded"
        | "unauthorized_install"
        | "installer_path_missing"
        | "generic_latest_rejected";
      message: string;
    };

/**
 * Minimal surface we require from electron-updater's AppUpdater.
 * Injectable for unit tests (no Electron required).
 */
export type ElectronUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  channel?: string;
  currentVersion?: { version: string } | string;
  setFeedURL: (options: { provider?: string; url: string; channel?: string }) => void;
  checkForUpdates: () => Promise<{ updateInfo?: { version?: string; sha512?: string; path?: string; files?: Array<{ sha512?: string; url?: string; size?: number }> } } | null>;
  downloadUpdate: () => Promise<string[]>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  cancel?: () => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type DeskUpdaterOptions = {
  /**
   * Injected updater. When omitted, `createDeskUpdater` loads electron-updater
   * lazily (packaged app only).
   */
  autoUpdater?: ElectronUpdaterLike;
  /** Factory used when autoUpdater is not injected. */
  loadAutoUpdater?: () => ElectronUpdaterLike;
  /** Compute SHA-256 of a local file (injectable). */
  hashFile?: (filePath: string) => Promise<string>;
  /** Clock for grant/feed expiry checks. */
  now?: () => number;
  /** Max age of a short-lived feed URL in ms (default 30 minutes). */
  maxFeedAgeMs?: number;
};

const GENERIC_LATEST_RE =
  /\/latest(\.yml|\.json)?(\?|$)/i;

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reject generic "latest" feeds and non-HTTPS endpoints.
 * Exact-version feeds must bind a version query, path segment, or grant.
 */
export function assertExactFeed(feed: ExactDeskFeed): DeskDownloadResult | null {
  if (!feed.version || typeof feed.version !== "string") {
    return { ok: false, code: "invalid_feed", message: "version required" };
  }
  if (!feed.feedUrl || !isHttpsUrl(feed.feedUrl)) {
    return {
      ok: false,
      code: "invalid_feed",
      message: "feedUrl must be https",
    };
  }
  if (!/^[a-fA-F0-9]{64}$/.test(feed.sha256)) {
    return { ok: false, code: "invalid_feed", message: "sha256 required" };
  }
  if (typeof feed.sizeBytes !== "number" || feed.sizeBytes < 0) {
    return { ok: false, code: "invalid_feed", message: "sizeBytes required" };
  }
  if (!feed.artifactId) {
    return { ok: false, code: "invalid_feed", message: "artifactId required" };
  }

  let parsed: URL;
  try {
    parsed = new URL(feed.feedUrl);
  } catch {
    return { ok: false, code: "invalid_feed", message: "invalid feedUrl" };
  }

  // Reject bare generic latest.yml without version binding.
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  if (GENERIC_LATEST_RE.test(pathAndQuery)) {
    const hasVersion =
      parsed.searchParams.has("version") ||
      parsed.searchParams.has("exactVersion") ||
      parsed.pathname.includes(`/${feed.version}/`) ||
      parsed.pathname.includes(`/${encodeURIComponent(feed.version)}/`) ||
      parsed.searchParams.get("artifactId") === feed.artifactId ||
      parsed.searchParams.has("grant") ||
      parsed.searchParams.has("token");
    if (!hasVersion) {
      return {
        ok: false,
        code: "generic_latest_rejected",
        message: "generic latest feed is not allowed; exact version feed required",
      };
    }
  }

  return null;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  stream.on("data", (chunk: string | Buffer) => {
    hash.update(chunk);
  });
  await finished(stream);
  return hash.digest("hex");
}

export type DeskUpdater = {
  downloadExact: (
    feed: ExactDeskFeed,
    options?: { onProgress?: (p: DeskDownloadProgress) => void },
  ) => Promise<DeskDownloadResult>;
  installOnRestart: () => Promise<DeskDownloadResult>;
  cancelDownload: () => void;
  /** True when a download completed and install is authorized by coordinator. */
  isReadyToInstall: () => boolean;
  /** Authorize installOnRestart (coordinator only). */
  authorizeInstall: () => void;
  getDownloaded: () => DeskDownloadResult | null;
};

/**
 * Create the narrow Desk updater wrapper.
 */
export function createDeskUpdater(options: DeskUpdaterOptions = {}): DeskUpdater {
  const hashFile = options.hashFile ?? sha256File;
  const now = options.now ?? (() => Date.now());
  const maxFeedAgeMs = options.maxFeedAgeMs ?? 30 * 60 * 1000;

  let updater: ElectronUpdaterLike | null = options.autoUpdater ?? null;
  let busy = false;
  let cancelled = false;
  let downloaded: Extract<DeskDownloadResult, { ok: true }> | null = null;
  let authorizedInstall = false;
  let feedFetchedAt = 0;
  let lastFeed: ExactDeskFeed | null = null;
  let progressHandler: ((p: DeskDownloadProgress) => void) | null = null;

  function ensureUpdater(): ElectronUpdaterLike {
    if (updater) return updater;
    if (options.loadAutoUpdater) {
      updater = options.loadAutoUpdater();
      return updater;
    }
    // Lazy require so unit tests never load electron-updater.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("electron-updater") as {
      autoUpdater: ElectronUpdaterLike;
    };
    updater = mod.autoUpdater;
    return updater;
  }

  function configureForExact(feed: ExactDeskFeed): void {
    const u = ensureUpdater();
    u.autoDownload = false;
    u.autoInstallOnAppQuit = false;
    u.allowDowngrade = feed.allowDowngrade === true;
    u.setFeedURL({
      provider: "generic",
      url: feed.feedUrl,
      channel: feed.version,
    });
  }

  async function verifyLocalFile(
    filePath: string,
    feed: ExactDeskFeed,
  ): Promise<DeskDownloadResult | null> {
    if (!filePath || !existsSync(filePath)) {
      return {
        ok: false,
        code: "installer_path_missing",
        message: "downloaded installer path is missing or not a local file",
      };
    }
    const st = statSync(filePath);
    if (!st.isFile()) {
      return {
        ok: false,
        code: "installer_path_missing",
        message: "downloaded installer path is not a regular file",
      };
    }
    if (feed.sizeBytes > 0 && st.size !== feed.sizeBytes) {
      return {
        ok: false,
        code: "size_mismatch",
        message: `expected size ${feed.sizeBytes}, got ${st.size}`,
      };
    }
    const digest = await hashFile(filePath);
    if (digest.toLowerCase() !== feed.sha256.toLowerCase()) {
      return {
        ok: false,
        code: "digest_mismatch",
        message: "downloaded desk artifact sha256 mismatch",
      };
    }
    return null;
  }

  return {
    async downloadExact(feed, opts) {
      if (busy) {
        return { ok: false, code: "busy", message: "download already in progress" };
      }
      const invalid = assertExactFeed(feed);
      if (invalid) return invalid;

      busy = true;
      cancelled = false;
      authorizedInstall = false;
      downloaded = null;
      lastFeed = { ...feed };
      feedFetchedAt = now();
      progressHandler = opts?.onProgress ?? null;

      try {
        configureForExact(feed);
        const u = ensureUpdater();

        // Wire progress if supported.
        const onProgress = (info: unknown) => {
          if (!progressHandler || !info || typeof info !== "object") return;
          const o = info as Record<string, unknown>;
          const transferred =
            typeof o.transferred === "number"
              ? o.transferred
              : typeof o.receivedBytes === "number"
                ? o.receivedBytes
                : 0;
          const total =
            typeof o.total === "number"
              ? o.total
              : typeof o.totalBytes === "number"
                ? o.totalBytes
                : undefined;
          const percent =
            typeof o.percent === "number"
              ? o.percent
              : total && total > 0
                ? (transferred / total) * 100
                : undefined;
          progressHandler({
            receivedBytes: transferred,
            totalBytes: total,
            percent,
          });
        };
        u.on?.("download-progress", onProgress);

        let updateInfo: {
          version?: string;
          sha512?: string;
          path?: string;
          files?: Array<{ sha512?: string; url?: string; size?: number }>;
        } | null = null;
        try {
          const result = await u.checkForUpdates();
          updateInfo = result?.updateInfo ?? null;
        } catch (err) {
          return {
            ok: false,
            code: "download_failed",
            message: err instanceof Error ? err.message : String(err),
          };
        }

        if (cancelled) {
          return { ok: false, code: "cancelled", message: "download cancelled" };
        }

        const foundVersion = updateInfo?.version;
        if (!foundVersion || foundVersion !== feed.version) {
          return {
            ok: false,
            code: "version_mismatch",
            message: `feed offered ${foundVersion ?? "none"}, required ${feed.version}`,
          };
        }

        // Optional SHA-512 cross-check when both sides publish it.
        if (feed.sha512 && updateInfo?.sha512) {
          const a = feed.sha512.replace(/\s+/g, "").toLowerCase();
          const b = updateInfo.sha512.replace(/\s+/g, "").toLowerCase();
          if (a !== b) {
            return {
              ok: false,
              code: "digest_mismatch",
              message: "updater sha512 does not match manifest",
            };
          }
        }

        let paths: string[] = [];
        try {
          paths = await u.downloadUpdate();
        } catch (err) {
          if (cancelled) {
            return { ok: false, code: "cancelled", message: "download cancelled" };
          }
          return {
            ok: false,
            code: "download_failed",
            message: err instanceof Error ? err.message : String(err),
          };
        }

        if (cancelled) {
          return { ok: false, code: "cancelled", message: "download cancelled" };
        }

        const localPath = (paths[0] ?? updateInfo?.path ?? "").trim();
        const verify = await verifyLocalFile(localPath, feed);
        if (verify) return verify;

        downloaded = {
          ok: true,
          version: feed.version,
          artifactId: feed.artifactId,
          sha256: feed.sha256.toLowerCase(),
          sizeBytes: feed.sizeBytes,
          path: localPath,
        };
        return downloaded;
      } finally {
        busy = false;
        progressHandler = null;
      }
    },

    cancelDownload() {
      cancelled = true;
      try {
        ensureUpdater().cancel?.();
      } catch {
        /* best-effort */
      }
    },

    authorizeInstall() {
      authorizedInstall = true;
    },

    isReadyToInstall() {
      return Boolean(downloaded?.ok && authorizedInstall);
    },

    getDownloaded() {
      return downloaded;
    },

    async installOnRestart() {
      if (!downloaded?.ok || !lastFeed) {
        return {
          ok: false,
          code: "not_downloaded",
          message: "no exact desk download staged",
        };
      }
      if (!authorizedInstall) {
        return {
          ok: false,
          code: "unauthorized_install",
          message: "coordinator has not authorized installOnRestart",
        };
      }
      // Feed must still be "fresh" enough for protected grants.
      if (now() - feedFetchedAt > maxFeedAgeMs) {
        return {
          ok: false,
          code: "invalid_feed",
          message: "short-lived feed expired; re-stage required",
        };
      }
      // Never install a version other than the resolved pair.
      if (downloaded.version !== lastFeed.version) {
        return {
          ok: false,
          code: "version_mismatch",
          message: "downloaded version diverged from resolved pair",
        };
      }
      if (
        downloaded.sha256.toLowerCase() !== lastFeed.sha256.toLowerCase()
      ) {
        return {
          ok: false,
          code: "digest_mismatch",
          message: "downloaded digest diverged from resolved pair",
        };
      }

      const verify = await verifyLocalFile(downloaded.path, lastFeed);
      if (verify) return verify;

      const u = ensureUpdater();
      // Keep autoInstallOnAppQuit false until this explicit call.
      u.autoInstallOnAppQuit = false;
      try {
        u.quitAndInstall(false, true);
      } catch (err) {
        return {
          ok: false,
          code: "download_failed",
          message: err instanceof Error ? err.message : String(err),
        };
      }
      return downloaded;
    },
  };
}
