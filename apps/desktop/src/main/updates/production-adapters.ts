/**
 * Production UpdateCoordinator adapters: signed-manifest resolve + stage/install.
 *
 * resolvePair: fetch/verify/cache manifest → shared resolvePair → ResolvedPairSnapshot.
 * stageGrok: download grant → stream artifact → RuntimeManager install with
 *   switchWhenIdle:false (pointer switch only via switchGrokRuntime when authorized).
 * stageDesk: download grant → exact Desk feed → desk-updater downloadExact.
 * installDeskOnRestart: authorize + desk-updater installOnRestart (coordinator only).
 *
 * When env/config is incomplete (no manifest URL/API base or empty release keys),
 * callers keep bootstrap stubs so unit tests never hit the network.
 */
import path from "node:path";
import type {
  CanonicalRuntimeTarget,
  CompatibilityManifestPayload,
  ReleaseArtifact,
  ReleaseChannel,
  ResolvedPair,
} from "@grokdesk/shared";
import {
  findArtifact,
  resolvePair as resolveCompatibilityPair,
} from "@grokdesk/shared";
import {
  createEntitlementClient,
  type createDownloadGrantResponse,
  type EntitlementClient,
  type redeemDownloadResponse,
} from "@grokdesk/entitlement-client";
import {
  RuntimeManager,
  stagingArtifactDir,
  stagingBinaryFileName,
} from "../runtime/runtime-manager.js";
import { RuntimeStore } from "../runtime/runtime-store.js";
import type { RuntimeVerifierDeps } from "../runtime/runtime-verifier.js";
import { ManifestCache } from "./manifest-cache.js";
import { fetchReleaseManifest } from "./manifest-client.js";
import {
  getBuiltInReleasePublicKeys,
  type ReleaseKeyRing,
} from "./manifest-verifier.js";
import {
  createDeskUpdater,
  type DeskUpdater,
  type ExactDeskFeed,
} from "./desk-updater.js";
import {
  snapshotFromResolvedPair,
  type InstallDeskResult,
  type ResolvedPairSnapshot,
  type StageDeskResult,
  type StageGrokResult,
  type SwitchRuntimeResult,
  type UpdateCoordinatorDeps,
} from "./update-coordinator.js";
import type {
  PreviousRuntimeRef,
  StagedArtifactRef,
} from "./update-journal.js";

/** Env: explicit signed-manifest URL (http(s) or dev fixture path). */
export const MANIFEST_URL_ENV = "GROKDESK_MANIFEST_URL" as const;
/** Env: entitlement API base; used for grants and default `/v1/releases/manifest`. */
export const ENTITLEMENT_API_URL_ENV = "GROKDESK_ENTITLEMENT_API_URL" as const;
/** Optional comma-separated extra hosts allowed for artifact redirects. */
export const DOWNLOAD_ALLOWED_HOSTS_ENV =
  "GROKDESK_DOWNLOAD_ALLOWED_HOSTS" as const;

export type DownloadGrantClient = {
  createDownloadGrant: (body: {
    artifactId: string;
    target: CanonicalRuntimeTarget;
    productKey?: string;
    activationId?: string;
  }) => Promise<createDownloadGrantResponse>;
  redeemDownload: (query: {
    grant: string;
  }) => Promise<
    | redeemDownloadResponse
    | { redirect: true; location: string }
  >;
};

export type ProductionUpdateAdaptersOptions = {
  userDataDir: string;
  /** Prefer injected store so bootstrap shares pointer state. */
  store?: RuntimeStore;
  runtimeManager?: RuntimeManager;
  isIdle: () => boolean | Promise<boolean>;
  /** Release key ring (defaults to the baked-in release trust root). */
  keys?: ReleaseKeyRing;
  /** Explicit manifest URL (overrides env + API base). */
  manifestUrl?: string;
  /** Entitlement API base for grants and default manifest path. */
  entitlementApiBase?: string | URL;
  env?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
  allowDevFixtureUrls?: boolean;
  /** Allow http:// artifact downloads (tests). Default false. */
  allowHttpDownloads?: boolean;
  fetchImpl?: typeof fetch;
  entitlementClient?: DownloadGrantClient | EntitlementClient;
  getDeviceCohortId?: () => string | Promise<string>;
  getActivationId?: () => string | null | Promise<string | null>;
  getProductKey?: () => string | null | Promise<string | null>;
  now?: () => Date;
  nowMs?: number;
  verifierDeps?: RuntimeVerifierDeps;
  /** Extra CDN hosts allowed beyond grant/redeem origins. */
  allowedDownloadHosts?: readonly string[];
  rebuildGateway?: (binaryPath: string) => void | Promise<void>;
  /**
   * Injected Desk updater (tests). When omitted, a real createDeskUpdater() is
   * used; electron-updater loads lazily on first downloadExact/install.
   */
  deskUpdater?: DeskUpdater;
};

export type ProductionUpdateAdapters = {
  resolvePair: UpdateCoordinatorDeps["resolvePair"];
  stageGrok: (
    pair: ResolvedPairSnapshot,
  ) => StageGrokResult | Promise<StageGrokResult>;
  switchGrokRuntime: (
    staged: StagedArtifactRef,
  ) => SwitchRuntimeResult | Promise<SwitchRuntimeResult>;
  restorePreviousRuntime: (
    previous: PreviousRuntimeRef,
  ) => SwitchRuntimeResult | Promise<SwitchRuntimeResult>;
  /** Exact-version Desk stage via desk-updater + download grant. */
  stageDesk: (
    pair: ResolvedPairSnapshot,
  ) => StageDeskResult | Promise<StageDeskResult>;
  /** Authorize + install-on-restart after coordinator idle admission. */
  installDeskOnRestart: (
    staged: StagedArtifactRef,
  ) => InstallDeskResult | Promise<InstallDeskResult>;
  /** True when adapters were constructed with live config. */
  configured: true;
  runtimeManager: RuntimeManager;
  store: RuntimeStore;
  deskUpdater: DeskUpdater;
};

type ResolveCache = {
  sequence: number;
  payloadSha256: string;
  acceptedKeyId: string;
  payload: CompatibilityManifestPayload;
  pair: ResolvedPair;
  checkedAt: string;
};

/**
 * Resolve manifest URL from env / options.
 * Prefers GROKDESK_MANIFEST_URL; else `${entitlementApiBase}/v1/releases/manifest`.
 */
export function resolveManifestUrlFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  entitlementApiBase?: string | URL,
): string | null {
  const explicit =
    typeof env[MANIFEST_URL_ENV] === "string"
      ? env[MANIFEST_URL_ENV]!.trim()
      : "";
  if (explicit) return explicit;

  const baseRaw =
    entitlementApiBase != null
      ? String(entitlementApiBase).trim()
      : typeof env[ENTITLEMENT_API_URL_ENV] === "string"
        ? env[ENTITLEMENT_API_URL_ENV]!.trim()
        : "";
  if (!baseRaw) return null;

  try {
    const base = baseRaw.endsWith("/") ? baseRaw.slice(0, -1) : baseRaw;
    // Avoid double /v1 when base already ends with /v1.
    if (base.endsWith("/v1")) {
      return `${base}/releases/manifest`;
    }
    return `${base}/v1/releases/manifest`;
  } catch {
    return null;
  }
}

export function isProductionUpdateConfigReady(input: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  keys?: ReleaseKeyRing;
  manifestUrl?: string | null;
  entitlementApiBase?: string | URL;
  isPackaged?: boolean;
  allowDevFixtureUrls?: boolean;
}): boolean {
  const env = input.env ?? {};
  const keys = input.keys ?? getBuiltInReleasePublicKeys({
    env,
    isPackaged: input.isPackaged ?? false,
    allowDevEnvOverride: input.allowDevFixtureUrls === true,
  });
  if (!keys || keys.size === 0) return false;
  const url =
    (input.manifestUrl && input.manifestUrl.trim()) ||
    resolveManifestUrlFromEnv(env, input.entitlementApiBase);
  return Boolean(url);
}

/**
 * Construct production adapters when config is ready; otherwise null so the
 * composition root can expose truthful fail-closed readiness.
 */
export function tryCreateProductionUpdateAdapters(
  options: ProductionUpdateAdaptersOptions,
): ProductionUpdateAdapters | null {
  const env = options.env ?? process.env;
  const keys = options.keys ?? getBuiltInReleasePublicKeys({
    env,
    isPackaged: options.isPackaged ?? false,
    allowDevEnvOverride: options.allowDevFixtureUrls === true,
  });
  const manifestUrl =
    options.manifestUrl?.trim() ||
    resolveManifestUrlFromEnv(env, options.entitlementApiBase);
  if (!manifestUrl || keys.size === 0) {
    return null;
  }
  return createProductionUpdateAdapters({
    ...options,
    keys,
    manifestUrl,
    env,
  });
}

export function createProductionUpdateAdapters(
  options: ProductionUpdateAdaptersOptions,
): ProductionUpdateAdapters {
  if (!options.userDataDir || typeof options.userDataDir !== "string") {
    throw new TypeError("userDataDir is required");
  }
  const env = options.env ?? process.env;
  const keys = options.keys ?? getBuiltInReleasePublicKeys({
    env,
    isPackaged: options.isPackaged ?? false,
    allowDevEnvOverride: options.allowDevFixtureUrls === true,
  });
  if (keys.size === 0) {
    throw new Error("release public keys are required for production adapters");
  }

  const manifestUrl =
    options.manifestUrl?.trim() ||
    resolveManifestUrlFromEnv(env, options.entitlementApiBase);
  if (!manifestUrl) {
    throw new Error(
      "manifest URL required (GROKDESK_MANIFEST_URL or entitlement API base)",
    );
  }
  const trustedManifestUrl: string = manifestUrl;

  const store =
    options.store ?? new RuntimeStore({ userData: options.userDataDir });
  store.ensureLayout();

  const now = options.now ?? (() => new Date());
  const isPackaged = options.isPackaged ?? false;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const runtimeManager =
    options.runtimeManager ??
    new RuntimeManager({
      store,
      isIdle: options.isIdle,
      rebuildGateway: options.rebuildGateway,
      now,
      verifierDeps: options.verifierDeps,
    });

  // Desk path uses narrow electron-updater wrapper; injectable for unit tests.
  const deskUpdater = options.deskUpdater ?? createDeskUpdater();

  const cacheDir = path.join(options.userDataDir, "updates");
  const manifestCache = new ManifestCache({ directory: cacheDir });

  const entitlementApiBase =
    options.entitlementApiBase != null
      ? String(options.entitlementApiBase)
      : typeof env[ENTITLEMENT_API_URL_ENV] === "string"
        ? env[ENTITLEMENT_API_URL_ENV]!.trim()
        : "";

  let grantClient: DownloadGrantClient | null =
    (options.entitlementClient as DownloadGrantClient | undefined) ?? null;
  if (!grantClient && entitlementApiBase) {
    try {
      grantClient = createEntitlementClient({
        baseUrl: new URL(entitlementApiBase),
        userAgent: "GrokDesk/update-adapters",
        fetch: fetchImpl,
      });
    } catch {
      grantClient = null;
    }
  }

  const extraHosts = parseAllowedHosts(
    options.allowedDownloadHosts,
    env[DOWNLOAD_ALLOWED_HOSTS_ENV],
  );

  /** Last successful resolve — supplies artifact metadata for stage. */
  let lastResolve: ResolveCache | null = null;

  const resolvePair: UpdateCoordinatorDeps["resolvePair"] = async (input) => {
    const nowMs = options.nowMs ?? now().getTime();
    const fetched = await fetchReleaseManifest({
      url: trustedManifestUrl,
      keys,
      cache: manifestCache,
      env: {
        isPackaged,
        allowDevFixtureUrls: options.allowDevFixtureUrls ?? false,
      },
      nowMs,
      requiredTarget: input.target,
      fetchImpl,
      clock: () => nowMs,
    });

    if (!fetched.ok) {
      throw new Error(`manifest_fetch:${fetched.code}:${fetched.message}`);
    }

    if (
      input.expectedSequence != null &&
      fetched.sequence !== input.expectedSequence
    ) {
      return null;
    }

    const deviceCohortId = options.getDeviceCohortId
      ? await options.getDeviceCohortId()
      : "anonymous";

    const pair = resolveCompatibilityPair(fetched.payload, {
      target: input.target,
      channel: input.channel,
      installedDeskVersion: input.installed.deskVersion,
      installedGrokVersion: input.installed.grokVersion,
      deviceCohortId,
      now: nowMs,
    });

    if (!pair) {
      lastResolve = null;
      return null;
    }

    lastResolve = {
      sequence: fetched.sequence,
      payloadSha256: fetched.payloadSha256,
      acceptedKeyId: fetched.acceptedKeyId,
      payload: fetched.payload,
      pair,
      checkedAt: fetched.checkedAt,
    };

    return snapshotFromResolvedPair(pair, {
      manifestSequence: fetched.sequence,
      manifestPayloadSha256: fetched.payloadSha256,
      installed: input.installed,
    });
  };

  const stageGrok = async (
    pair: ResolvedPairSnapshot,
  ): Promise<StageGrokResult> => {
    try {
      const artifact = await resolveGrokArtifact(pair);
      if (!artifact) {
        return {
          ok: false,
          code: "artifact_missing",
          message: `Grok artifact ${pair.grokArtifactId} not found in resolved manifest`,
        };
      }

      const download = await obtainDownloadUrl({
        artifact,
        target: pair.target,
        grantClient,
        entitlementApiBase,
        fetchImpl,
        getActivationId: options.getActivationId,
        getProductKey: options.getProductKey,
      });
      if (!download.ok) {
        return {
          ok: false,
          code: download.code,
          message: download.message,
        };
      }

      const allowedHosts = uniqueHosts([
        ...extraHosts,
        ...download.allowedHosts,
      ]);
      const destDir = stagingArtifactDir(
        options.userDataDir,
        pair.grokArtifactId,
      );
      const fileName = stagingBinaryFileName(pair.target);

      const installed = await runtimeManager.installFromDownload({
        download: {
          artifactId: pair.grokArtifactId,
          url: download.url,
          expectedSize: pair.grokSizeBytes,
          expectedSha256: pair.grokSha256,
          allowedHosts,
          destDir,
          fileName,
        },
        downloadOptions: {
          fetchImpl,
          allowHttp: options.allowHttpDownloads === true,
        },
        artifactId: pair.grokArtifactId,
        version: pair.grokVersion,
        target: pair.target,
        expectedSha256: pair.grokSha256,
        expectedSizeBytes: pair.grokSizeBytes,
        provenance: artifact.provenance,
        signingPolicy: artifact.signingPolicy,
        requiredCapabilities: pair.capabilities,
        declaredCapabilities:
          artifact.capabilities ?? pair.capabilities ?? [],
        manifestSequence: pair.manifestSequence,
        manifestKeyId:
          lastResolve?.acceptedKeyId ??
          lastResolve?.payloadSha256.slice(0, 16) ??
          "unknown",
        // Coordinator owns pointer switch — never switch during stage.
        switchWhenIdle: false,
      });

      if (!installed.ok) {
        return {
          ok: false,
          code: installed.code,
          message: installed.message,
        };
      }

      if (installed.switched) {
        return {
          ok: false,
          code: "stage_switched",
          message: "stageGrok must not switch current runtime",
        };
      }

      const staged: StagedArtifactRef = {
        kind: "grok",
        artifactId: pair.grokArtifactId,
        version: pair.grokVersion,
        digestSha256: installed.ref.digestSha256,
        sizeBytes: pair.grokSizeBytes,
        path: installed.binaryPath,
      };

      return { ok: true, staged, switched: false };
    } catch (err) {
      return {
        ok: false,
        code: "stage_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const switchGrokRuntime = async (
    staged: StagedArtifactRef,
  ): Promise<SwitchRuntimeResult> => {
    if (staged.kind !== "grok") {
      return {
        ok: false,
        code: "invalid_staged",
        message: "switchGrokRuntime requires a grok staged artifact",
      };
    }
    const target =
      lastResolve?.pair.target ??
      inferTargetFromBinaryPath(staged.path) ??
      null;
    if (!target) {
      return {
        ok: false,
        code: "target_unknown",
        message: "cannot determine runtime target for staged Grok",
      };
    }

    const prior = store.loadPointer();
    const previous: PreviousRuntimeRef | null =
      prior.ok && prior.pointer.current
        ? {
            version: prior.pointer.current.version,
            target: prior.pointer.current.target,
            digestSha256: prior.pointer.current.digestSha256,
          }
        : null;

    const result = await runtimeManager.trySwitchInstalled({
      version: staged.version,
      target,
      digestSha256: staged.digestSha256,
    });

    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }
    if (!result.switched) {
      return {
        ok: false,
        code: result.waitingForIdle ? "not_idle" : "switch_failed",
        message: result.waitingForIdle
          ? "work active; switch deferred"
          : "runtime switch did not complete",
      };
    }
    return { ok: true, previous };
  };

  const restorePreviousRuntime = async (
    previous: PreviousRuntimeRef,
  ): Promise<SwitchRuntimeResult> => {
    const result = await runtimeManager.trySwitchInstalled({
      version: previous.version,
      target: previous.target,
      digestSha256: previous.digestSha256,
    });
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }
    if (!result.switched) {
      return {
        ok: false,
        code: result.waitingForIdle ? "not_idle" : "switch_failed",
        message: "restore previous runtime did not complete",
      };
    }
    return { ok: true, previous: null };
  };

  const stageDesk = async (
    pair: ResolvedPairSnapshot,
  ): Promise<StageDeskResult> => {
    try {
      const artifact = await resolveDeskArtifact(pair);
      if (!artifact) {
        return {
          ok: false,
          code: "artifact_missing",
          message: `Desk artifact ${pair.deskArtifactId} not found in resolved manifest`,
        };
      }

      const download = await obtainDownloadUrl({
        artifact,
        target: pair.target,
        grantClient,
        entitlementApiBase,
        fetchImpl,
        getActivationId: options.getActivationId,
        getProductKey: options.getProductKey,
      });
      if (!download.ok) {
        return {
          ok: false,
          code: download.code,
          message: download.message,
        };
      }

      const feed = ensureExactDeskFeedBinding({
        version: pair.deskVersion,
        feedUrl: download.url,
        artifactId: pair.deskArtifactId,
        sha256: pair.deskSha256,
        sizeBytes: pair.deskSizeBytes,
        allowDowngrade: pair.allowDeskDowngrade,
        // grant token is short-lived memory only — never journaled.
        grantId: download.grant,
      });

      const result = await deskUpdater.downloadExact(feed);
      if (!result.ok) {
        return {
          ok: false,
          code: result.code,
          message: result.message,
        };
      }
      if (!result.path || !path.isAbsolute(result.path)) {
        return {
          ok: false,
          code: "installer_path_missing",
          message: "desk updater did not return a concrete installer path",
        };
      }

      // Never put feed URLs or grants on the staged ref (journal-safe).
      const staged: StagedArtifactRef = {
        kind: "desk",
        artifactId: pair.deskArtifactId,
        version: pair.deskVersion,
        digestSha256: result.sha256,
        sizeBytes: result.sizeBytes,
        path: result.path,
      };
      return { ok: true, staged };
    } catch (err) {
      return {
        ok: false,
        code: "stage_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const installDeskOnRestart = async (
    staged: StagedArtifactRef,
  ): Promise<InstallDeskResult> => {
    if (staged.kind !== "desk") {
      return {
        ok: false,
        code: "invalid_staged",
        message: "installDeskOnRestart requires a desk staged artifact",
      };
    }

    const downloaded = deskUpdater.getDownloaded();
    if (!downloaded?.ok) {
      return {
        ok: false,
        code: "not_downloaded",
        message: "no exact desk download staged via deskUpdater",
      };
    }

    if (
      downloaded.version !== staged.version ||
      downloaded.artifactId !== staged.artifactId ||
      downloaded.sha256.toLowerCase() !== staged.digestSha256.toLowerCase()
    ) {
      return {
        ok: false,
        code: "staged_mismatch",
        message: "staged desk artifact does not match deskUpdater download",
      };
    }

    // Coordinator authorizes install only after idle admission.
    deskUpdater.authorizeInstall();
    const result = await deskUpdater.installOnRestart();
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message,
      };
    }
    return { ok: true, willRestart: true };
  };

  async function resolveDeskArtifact(
    pair: ResolvedPairSnapshot,
  ): Promise<ReleaseArtifact | null> {
    if (
      lastResolve &&
      lastResolve.pair.pairId === pair.pairId &&
      lastResolve.sequence === pair.manifestSequence &&
      lastResolve.payloadSha256.toLowerCase() ===
        pair.manifestPayloadSha256.toLowerCase()
    ) {
      return lastResolve.pair.deskArtifact;
    }

    // Re-fetch for resume paths after process restart.
    const nowMs = options.nowMs ?? now().getTime();
    const fetched = await fetchReleaseManifest({
      url: trustedManifestUrl,
      keys,
      cache: manifestCache,
      env: {
        isPackaged,
        allowDevFixtureUrls: options.allowDevFixtureUrls ?? false,
      },
      nowMs,
      requiredTarget: pair.target,
      fetchImpl,
      clock: () => nowMs,
    });
    if (!fetched.ok) return null;
    if (fetched.sequence !== pair.manifestSequence) return null;
    if (
      fetched.payloadSha256.toLowerCase() !==
      pair.manifestPayloadSha256.toLowerCase()
    ) {
      return null;
    }
    const art = findArtifact(
      fetched.payload,
      pair.deskArtifactId,
      pair.channel,
    );
    if (!art || art.kind !== "desk") return null;
    const grokArt = findArtifact(
      fetched.payload,
      pair.grokArtifactId,
      pair.channel,
    );
    if (!grokArt || grokArt.kind !== "grok") return null;
    lastResolve = {
      sequence: fetched.sequence,
      payloadSha256: fetched.payloadSha256,
      acceptedKeyId: fetched.acceptedKeyId,
      payload: fetched.payload,
      pair: {
        pairId: pair.pairId,
        channel: pair.channel,
        target: pair.target,
        deskVersion: pair.deskVersion,
        grokVersion: pair.grokVersion,
        deskArtifactId: pair.deskArtifactId,
        grokArtifactId: pair.grokArtifactId,
        capabilities: [...pair.capabilities],
        deskArtifact: art,
        grokArtifact: grokArt,
        reason: "upgrade",
        securityForced: false,
      },
      checkedAt: fetched.checkedAt,
    };
    return art;
  }

  async function resolveGrokArtifact(
    pair: ResolvedPairSnapshot,
  ): Promise<ReleaseArtifact | null> {
    if (
      lastResolve &&
      lastResolve.pair.pairId === pair.pairId &&
      lastResolve.sequence === pair.manifestSequence &&
      lastResolve.payloadSha256.toLowerCase() ===
        pair.manifestPayloadSha256.toLowerCase()
    ) {
      return lastResolve.pair.grokArtifact;
    }

    // Re-fetch for resume paths after process restart.
    const nowMs = options.nowMs ?? now().getTime();
    const fetched = await fetchReleaseManifest({
      url: trustedManifestUrl,
      keys,
      cache: manifestCache,
      env: {
        isPackaged,
        allowDevFixtureUrls: options.allowDevFixtureUrls ?? false,
      },
      nowMs,
      requiredTarget: pair.target,
      fetchImpl,
      clock: () => nowMs,
    });
    if (!fetched.ok) return null;
    if (fetched.sequence !== pair.manifestSequence) return null;
    if (
      fetched.payloadSha256.toLowerCase() !==
      pair.manifestPayloadSha256.toLowerCase()
    ) {
      return null;
    }
    const art = findArtifact(
      fetched.payload,
      pair.grokArtifactId,
      pair.channel,
    );
    if (!art || art.kind !== "grok") return null;
    const deskArt = findArtifact(
      fetched.payload,
      pair.deskArtifactId,
      pair.channel,
    );
    if (!deskArt || deskArt.kind !== "desk") return null;
    lastResolve = {
      sequence: fetched.sequence,
      payloadSha256: fetched.payloadSha256,
      acceptedKeyId: fetched.acceptedKeyId,
      payload: fetched.payload,
      pair: {
        pairId: pair.pairId,
        channel: pair.channel,
        target: pair.target,
        deskVersion: pair.deskVersion,
        grokVersion: pair.grokVersion,
        deskArtifactId: pair.deskArtifactId,
        grokArtifactId: pair.grokArtifactId,
        capabilities: [...pair.capabilities],
        deskArtifact: deskArt,
        grokArtifact: art,
        reason: "upgrade",
        securityForced: false,
      },
      checkedAt: fetched.checkedAt,
    };
    return art;
  }

  return {
    resolvePair,
    stageGrok,
    stageDesk,
    switchGrokRuntime,
    restorePreviousRuntime,
    installDeskOnRestart,
    configured: true,
    runtimeManager,
    store,
    deskUpdater,
  };
}

/**
 * Ensure generic latest feeds carry exact version/artifact binding so
 * desk-updater rejects bare "latest" channels. Non-latest URLs are unchanged
 * (signed query strings must not be rewritten).
 */
export function ensureExactDeskFeedBinding(feed: ExactDeskFeed): ExactDeskFeed {
  let parsed: URL;
  try {
    parsed = new URL(feed.feedUrl);
  } catch {
    return feed;
  }

  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  const isGenericLatest = /\/latest(\.yml|\.json)?(\?|$)/i.test(pathAndQuery);
  if (!isGenericLatest) {
    return feed;
  }

  const hasVersion =
    parsed.searchParams.has("version") ||
    parsed.searchParams.has("exactVersion") ||
    parsed.pathname.includes(`/${feed.version}/`) ||
    parsed.pathname.includes(`/${encodeURIComponent(feed.version)}/`) ||
    parsed.searchParams.get("artifactId") === feed.artifactId ||
    parsed.searchParams.has("grant") ||
    parsed.searchParams.has("token");

  if (hasVersion) {
    return feed;
  }

  parsed.searchParams.set("version", feed.version);
  parsed.searchParams.set("artifactId", feed.artifactId);
  return { ...feed, feedUrl: parsed.href };
}

function parseAllowedHosts(
  explicit: readonly string[] | undefined,
  envCsv: string | undefined,
): string[] {
  const out: string[] = [];
  if (explicit) out.push(...explicit);
  if (envCsv?.trim()) {
    for (const part of envCsv.split(",")) {
      const h = part.trim();
      if (h) out.push(h);
    }
  }
  return out;
}

function uniqueHosts(hosts: readonly string[]): string[] {
  const set = new Set<string>();
  for (const h of hosts) {
    const t = h.trim().toLowerCase();
    if (t) set.add(t);
  }
  return [...set];
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function inferTargetFromBinaryPath(
  binaryPath: string,
): CanonicalRuntimeTarget | null {
  // .../runtimes/grok/<version>/<target>/grok
  const parts = binaryPath.split(path.sep);
  const idx = parts.lastIndexOf("grok");
  // Prefer parent directory name when it looks like a target.
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i];
    if (
      seg === "darwin-arm64" ||
      seg === "darwin-x64" ||
      seg === "win32-x64" ||
      seg === "win32-arm64"
    ) {
      return seg;
    }
  }
  void idx;
  return null;
}

async function obtainDownloadUrl(input: {
  artifact: ReleaseArtifact;
  target: CanonicalRuntimeTarget;
  grantClient: DownloadGrantClient | null;
  entitlementApiBase: string;
  fetchImpl: typeof fetch;
  getActivationId?: () => string | null | Promise<string | null>;
  getProductKey?: () => string | null | Promise<string | null>;
}): Promise<
  | { ok: true; url: string; allowedHosts: string[]; grant?: string }
  | { ok: false; code: string; message: string }
> {
  const activationId = input.getActivationId
    ? await input.getActivationId()
    : null;
  const productKey = input.getProductKey ? await input.getProductKey() : null;

  if (!input.grantClient) {
    return {
      ok: false,
      code: "grant_client_missing",
      message:
        "download grant client not configured (set GROKDESK_ENTITLEMENT_API_URL)",
    };
  }

  let grantResp: createDownloadGrantResponse;
  try {
    grantResp = await input.grantClient.createDownloadGrant({
      artifactId: input.artifact.artifactId,
      target: input.target,
      ...(activationId ? { activationId } : {}),
      ...(productKey && !activationId ? { productKey } : {}),
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "grant_failed";
    return {
      ok: false,
      code,
      message: err instanceof Error ? err.message : "download grant failed",
    };
  }

  const grant = grantResp.grant;
  if (!grant) {
    return {
      ok: false,
      code: "grant_invalid",
      message: "download grant response missing grant token",
    };
  }

  let redeem: redeemDownloadResponse | { redirect: true; location: string };
  try {
    redeem = await input.grantClient.redeemDownload({ grant });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "redeem_failed";
    return {
      ok: false,
      code,
      message: err instanceof Error ? err.message : "download redeem failed",
    };
  }

  let url: string | null = null;
  if (redeem && typeof redeem === "object") {
    if ("redirect" in redeem && redeem.redirect && "location" in redeem) {
      url = String(redeem.location);
    } else if ("url" in redeem && typeof redeem.url === "string") {
      url = redeem.url;
    }
  }
  if (!url) {
    return {
      ok: false,
      code: "redeem_invalid",
      message: "redeem did not return a download URL",
    };
  }

  // Resolve relative locations against entitlement API.
  if (url.startsWith("/")) {
    if (!input.entitlementApiBase) {
      return {
        ok: false,
        code: "redeem_invalid",
        message: "relative redeem location requires entitlement API base",
      };
    }
    url = new URL(url, input.entitlementApiBase).href;
  }

  const hosts: string[] = [];
  const artifactHost = hostFromUrl(url);
  if (artifactHost) hosts.push(artifactHost);
  if (input.entitlementApiBase) {
    const apiHost = hostFromUrl(input.entitlementApiBase);
    if (apiHost) hosts.push(apiHost);
  }

  return { ok: true, url, allowedHosts: hosts, grant };
}
