/**
 * Runtime + update composition adapter for Electron main.
 *
 * - Recovers side-by-side managed Grok under userData
 * - Selects the RuntimeStore-verified Grok binary (no global PATH discovery)
 * - Builds UpdateCoordinator + UpdateScheduler with truthful fail-closed readiness
 *
 * Call `createUpdateBootstrap` after entitlement bootstrap and before gateway start
 * so the child inherits the managed binary path.
 */

import path from "node:path";
import type {
  CanonicalRuntimeTarget,
  ReleaseChannel,
} from "@grokdesk/shared";
import { isCanonicalRuntimeTarget, toRuntimeTarget } from "@grokdesk/shared";
import { grokRuntimeRoot } from "../runtime/runtime-paths.js";
import { recoverRuntime } from "../runtime/runtime-recovery.js";
import { RuntimeStore } from "../runtime/runtime-store.js";
import {
  UpdateCoordinator,
  type ResolvedPairSnapshot,
  type StageDeskResult,
  type StageGrokResult,
  type SwitchRuntimeResult,
  type InstallDeskResult,
  type UpdateCoordinatorDeps,
} from "./update-coordinator.js";
import {
  UpdateJournalStore,
  journalVersionRefs,
  type InstalledPairRef,
  type StagedArtifactRef,
} from "./update-journal.js";
import {
  createUpdateScheduler,
  type UpdateScheduler,
} from "./update-scheduler.js";
import { atomicWriteFile } from "./manifest-cache.js";
import type { UpdateHealthDeps } from "./update-health.js";
import {
  tryCreateProductionUpdateAdapters,
  type DownloadGrantClient,
  type ProductionUpdateAdapters,
} from "./production-adapters.js";
import type { EntitlementClient } from "@grokdesk/entitlement-client";

type UpdateHealthGateway = {
  getStatus: () => string;
  request: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
};

/** Env key the gateway may receive for the managed Grok binary (absolute path). */
export const MANAGED_GROK_BINARY_ENV = "GROKDESK_MANAGED_GROK_BINARY" as const;
export const RUNTIME_READINESS_STATE_ENV =
  "GROKDESK_RUNTIME_READINESS_STATE_PATH" as const;
export const RUNTIME_READINESS_FILENAME = "runtime-readiness.json" as const;

export type RuntimeReadinessState = {
  schemaVersion: 1;
  managedRuntimeReady: boolean;
  updatesReady: boolean;
  admissionPaused: boolean;
  securityBlocked: boolean;
  reason:
    | "ready"
    | "managed_runtime_unavailable"
    | "update_readiness_unavailable"
    | "admission_paused"
    | "security_block";
  updatedAt: string;
};

/**
 * Tray statuses that mean interactive work is active — do not switch/install.
 * Gateway maps task `running` → `working`, and waiting states → `needs_you`.
 */
export const ACTIVE_TRAY_STATUSES = new Set(["working", "needs_you"]);

export type UpdateBootstrapOptions = {
  /** Electron `app.getPath("userData")` (or test temp dir). */
  userDataDir: string;
  /** Desk app version for installed-pair bookkeeping. */
  deskVersion: string;
  /** Release channel (default stable). */
  channel?: ReleaseChannel;
  /**
   * Canonical runtime target. Defaults to `process.platform` + `process.arch`.
   * Required when process target is unsupported (tests inject).
   */
  target?: CanonicalRuntimeTarget;
  /**
   * Idle admission. Defaults to tray-status poll when `getTrayStatus` is set,
   * otherwise always-true (safe for early bootstrap before gateway).
   */
  isIdle?: () => boolean | Promise<boolean>;
  /** Optional tray status reader (`idle` | `working` | `needs_you` | `paused`). */
  getTrayStatus?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Env object to mutate (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Injected store (tests). */
  runtimeStore?: RuntimeStore;
  /** Injected journal (tests). */
  journal?: UpdateJournalStore;
  /** Coordinator resolvePair (default: production when configured, else null). */
  resolvePair?: UpdateCoordinatorDeps["resolvePair"];
  stageGrok?: (
    pair: ResolvedPairSnapshot,
  ) => StageGrokResult | Promise<StageGrokResult>;
  stageDesk?: (
    pair: ResolvedPairSnapshot,
  ) => StageDeskResult | Promise<StageDeskResult>;
  switchGrokRuntime?: (
    staged: StagedArtifactRef,
  ) => SwitchRuntimeResult | Promise<SwitchRuntimeResult>;
  restorePreviousRuntime?: UpdateCoordinatorDeps["restorePreviousRuntime"];
  installDeskOnRestart?: (
    staged: StagedArtifactRef,
  ) => InstallDeskResult | Promise<InstallDeskResult>;
  /**
   * Prebuilt production adapters (tests / custom composition).
   * When omitted, adapters are auto-created from env when configured.
   */
  productionAdapters?: ProductionUpdateAdapters | null;
  /**
   * Disable auto production wiring even when env is set (tests).
   * Explicit resolvePair/stageGrok injections always win.
   */
  disableProductionAdapters?: boolean;
  /** Entitlement API base for default manifest URL + download grants. */
  entitlementApiBase?: string | URL;
  /** Shared entitlement client for download grants. */
  entitlementClient?: DownloadGrantClient | EntitlementClient;
  /** Opaque device cohort id for rollout (typically deviceId). */
  getDeviceCohortId?: () => string | Promise<string>;
  /** Active activation id for download grants. */
  getActivationId?: () => string | null | Promise<string | null>;
  /** Packaged Electron build flag (local fixtures never allowed when true). */
  isPackaged?: boolean;
  /**
   * After managed Grok pointer switch: set env + restart gateway with new binary.
   * Passed into production RuntimeManager when adapters auto-wire.
   */
  rebuildGateway?: (binaryPath: string) => void | Promise<void>;
  health?: Partial<UpdateHealthDeps>;
  onError?: (err: unknown, context: string) => void;
  onStatus?: UpdateCoordinatorDeps["onStatus"];
  /** Scheduler interval overrides (tests). */
  intervalMs?: number;
  jitterFraction?: number;
  random?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  now?: () => Date;
};

export type UpdateBootstrap = {
  /** Runtime root: `<userData>/runtimes/grok`. */
  runtimeRoot: string;
  store: RuntimeStore;
  journal: UpdateJournalStore;
  coordinator: UpdateCoordinator;
  scheduler: UpdateScheduler;
  /** Production resolve/stage adapters when env/config is complete. */
  productionAdapters: ProductionUpdateAdapters | null;
  /** Recovery notes from startup `recoverRuntime`. */
  recoveryNotes: readonly string[];
  /** Start scheduler (journal recover + first check + interval). */
  start: () => Promise<void>;
  stop: () => void;
  /** Current managed binary path (also mirrored in env when absolute). */
  getManagedBinaryPath: () => string | null;
  /**
   * Re-read pointer after a switch and refresh env.
   * Safe to call after install/switch.
   */
  refreshManagedBinaryFromStore: () => string | null;
  /** Main-owned truth used by dictation and mirrored atomically to gateway. */
  getGrokOperationReadiness: () => {
    ready: boolean;
    reason: RuntimeReadinessState["reason"];
  };
};

/**
 * Resolve managed Grok runtime root under Electron userData.
 */
export function resolveUpdateRuntimeRoot(userDataDir: string): string {
  return grokRuntimeRoot(userDataDir);
}

/**
 * Build live post-update probes against the currently owned gateway instance.
 * The getter is evaluated per probe so a rebuilt gateway is never captured.
 */
export function createGatewayUpdateHealth(
  getGateway: () => UpdateHealthGateway | null | undefined,
): Required<
  Pick<UpdateHealthDeps, "probeGateway" | "probeAuthStatus" | "probeMain">
> {
  const readyGateway = () => {
    const gateway = getGateway();
    return gateway?.getStatus() === "ready" ? gateway : null;
  };
  const failureMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  return {
    probeGateway: async () => {
      const gateway = readyGateway();
      if (!gateway) {
        return {
          ok: false,
          code: "gateway_not_ready",
          message: "Gateway is not ready",
        };
      }
      try {
        await gateway.request("tray.status", {});
        return { ok: true, detail: "tray.status responsive" };
      } catch (error) {
        return {
          ok: false,
          code: "gateway_rpc_failed",
          message: failureMessage(error),
        };
      }
    },
    probeAuthStatus: async () => {
      const gateway = readyGateway();
      if (!gateway) {
        return {
          ok: false,
          code: "gateway_not_ready",
          message: "Gateway is not ready",
        };
      }
      try {
        await gateway.request("auth.status", {});
        return { ok: true, detail: "auth.status responsive" };
      } catch (error) {
        return {
          ok: false,
          code: "auth_status_failed",
          message: failureMessage(error),
        };
      }
    },
    probeMain: async () => ({ ok: true, detail: "in_process" }),
  };
}

/**
 * True when tray status indicates no active interactive work.
 * Unknown/empty is treated as idle so bootstrap can proceed pre-gateway.
 */
export function isUpdateIdleTrayStatus(
  status: string | null | undefined,
): boolean {
  if (!status) return true;
  if (ACTIVE_TRAY_STATUSES.has(status)) return false;
  return status === "idle" || status === "paused";
}

/**
 * Set or clear `GROKDESK_MANAGED_GROK_BINARY` on the given env object.
 * Only absolute paths are accepted (PATH discovery is never used).
 */
export function applyManagedGrokBinaryEnv(
  binaryPath: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const trimmed = typeof binaryPath === "string" ? binaryPath.trim() : "";
  if (!trimmed || !path.isAbsolute(trimmed)) {
    delete env[MANAGED_GROK_BINARY_ENV];
    return null;
  }
  env[MANAGED_GROK_BINARY_ENV] = trimmed;
  return trimmed;
}

/**
 * Minimal gateway surface used after a managed runtime switch.
 * GatewayProcess exposes stop/start (no dedicated restart API).
 */
export type RebuildGatewayProcess = {
  setManagedBinaryPath: (binaryPath: string) => void;
  stop: () => void | Promise<void>;
  start: () => void | Promise<void>;
};

export type RebuildGatewayHandlerOptions = {
  /**
   * Resolve the live gateway process. Null/undefined fails the switch so the
   * runtime manager can preserve or restore the prior pointer.
   */
  getGateway: () => RebuildGatewayProcess | null | undefined;
  /** Env object to mutate (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Optional diagnostics (main log). */
  onLog?: (message: string, detail?: string) => void;
};

/**
 * Build the RuntimeManager `rebuildGateway` callback:
 * 1. Set `GROKDESK_MANAGED_GROK_BINARY` to the verified absolute path
 * 2. stop + start the gateway so the child inherits the new binary
 *
 * Missing gateway / stop / start failures propagate so RuntimeManager rolls
 * back the pointer. The explicit verified path is installed on the live
 * GatewayProcess before restart; ambient env is never its provenance.
 */
export function createRebuildGatewayHandler(
  options: RebuildGatewayHandlerOptions,
): (binaryPath: string) => Promise<void> {
  const env = options.env ?? process.env;
  return async (binaryPath: string) => {
    const trimmed = binaryPath.trim();
    if (!trimmed || !path.isAbsolute(trimmed)) {
      applyManagedGrokBinaryEnv(null, env);
      throw new Error(
        `rebuildGateway requires an absolute managed binary path (got ${JSON.stringify(binaryPath)})`,
      );
    }

    const gw = options.getGateway();
    if (!gw) {
      throw new Error("rebuildGateway: gateway process is not ready");
    }
    const applied = applyManagedGrokBinaryEnv(trimmed, env)!;

    options.onLog?.(
      "rebuildGateway: restarting gateway with managed binary",
      applied,
    );
    gw.setManagedBinaryPath(applied);
    await gw.stop();
    await gw.start();
  };
}

function resolveCanonicalTarget(
  explicit?: CanonicalRuntimeTarget,
): CanonicalRuntimeTarget {
  if (explicit) return explicit;
  const t = toRuntimeTarget(process.platform, process.arch);
  if (isCanonicalRuntimeTarget(t)) return t;
  // Journal requires a canonical target; unsupported hosts still boot without
  // selecting artifacts (resolvePair stays null).
  return "darwin-arm64";
}

function notConfiguredStage(
  kind: "grok" | "desk",
): StageGrokResult | StageDeskResult {
  return {
    ok: false,
    code: "not_configured",
    message: `${kind} staging is not wired in this bootstrap`,
  };
}

/**
 * Compose runtime recovery + update coordinator/scheduler for main.
 * Sets managed binary env immediately when a complete install is selected.
 */
export function createUpdateBootstrap(
  opts: UpdateBootstrapOptions,
): UpdateBootstrap {
  if (!opts.userDataDir || typeof opts.userDataDir !== "string") {
    throw new TypeError("userDataDir is required");
  }
  if (!opts.deskVersion || typeof opts.deskVersion !== "string") {
    throw new TypeError("deskVersion is required");
  }

  const userData = opts.userDataDir;
  const env = opts.env ?? process.env;
  const channel: ReleaseChannel = opts.channel ?? "stable";
  const target = resolveCanonicalTarget(opts.target);
  const now = opts.now ?? (() => new Date());
  const readinessPath = path.join(
    userData,
    "updates",
    RUNTIME_READINESS_FILENAME,
  );
  env[RUNTIME_READINESS_STATE_ENV] = readinessPath;

  const store = opts.runtimeStore ?? new RuntimeStore({ userData, now });
  store.ensureLayout();
  const runtimeRoot = resolveUpdateRuntimeRoot(userData);

  const journal =
    opts.journal ?? new UpdateJournalStore({ userData, now });
  const journalRefs = journalVersionRefs(journal.load());

  const recovery = recoverRuntime({
    store,
    journal: {
      versions: journalRefs.versions,
      stagingPaths: journalRefs.stagingPaths,
    },
  });

  let managedBinaryPath = applyManagedGrokBinaryEnv(recovery.binaryPath, env);

  const isIdle: () => boolean | Promise<boolean> =
    opts.isIdle ??
    (async () => {
      if (opts.getTrayStatus) {
        return isUpdateIdleTrayStatus(await opts.getTrayStatus());
      }
      return true;
    });

  const getInstalled = (): InstalledPairRef => {
    const j = journal.load();
    if (j?.installed) return j.installed;
    const pointer = store.loadPointer();
    const grokVersion =
      pointer.ok && pointer.pointer
        ? pointer.pointer.current.version
        : recovery.pointer?.current.version ?? "0.0.0";
    return {
      deskVersion: opts.deskVersion,
      grokVersion,
    };
  };

  const health: UpdateHealthDeps = {
    getDeskVersion: () => opts.deskVersion,
    getGrokVersion: async () => {
      const p = store.loadPointer();
      if (p.ok) return p.pointer.current.version;
      return recovery.pointer?.current.version ?? "";
    },
    getGrokDigest: async () => {
      const p = store.loadPointer();
      if (p.ok) return p.pointer.current.digestSha256;
      return recovery.pointer?.current.digestSha256 ?? "";
    },
    getGrokCapabilities: async () => {
      const p = store.loadPointer();
      if (!p.ok) return [];
      const rec = store.loadInstallation(
        p.pointer.current.version,
        p.pointer.current.target,
      );
      return rec?.capabilities ?? [];
    },
    getTarget: () => target,
    probeGateway: async () => ({
      ok: false,
      code: "gateway_probe_not_configured",
      message: "Gateway health probe is not configured",
    }),
    probeAuthStatus: async () => ({
      ok: false,
      code: "auth_probe_not_configured",
      message: "Auth health probe is not configured",
    }),
    probeMain: async () => ({ ok: true, detail: "in_process" }),
    ...opts.health,
  };

  // Production adapters when manifest URL/API base + release keys are present.
  // Explicit coordinator deps always win; incomplete config remains blocked.
  let productionAdapters: ProductionUpdateAdapters | null = null;
  if (opts.productionAdapters !== undefined) {
    productionAdapters = opts.productionAdapters;
  } else if (!opts.disableProductionAdapters) {
    try {
      productionAdapters = tryCreateProductionUpdateAdapters({
        userDataDir: userData,
        store,
        isIdle,
        env,
        entitlementApiBase: opts.entitlementApiBase,
        entitlementClient: opts.entitlementClient,
        getDeviceCohortId: opts.getDeviceCohortId,
        getActivationId: opts.getActivationId,
        isPackaged: opts.isPackaged ?? false,
        rebuildGateway: opts.rebuildGateway,
        now,
      });
    } catch (err) {
      console.error("[update-bootstrap] production adapters failed to init", err);
      productionAdapters = null;
    }
  }

  const resolvePair =
    opts.resolvePair ??
    productionAdapters?.resolvePair ??
    (async () => null as ResolvedPairSnapshot | null);

  const stageGrok =
    opts.stageGrok ??
    productionAdapters?.stageGrok ??
    (async () => notConfiguredStage("grok") as StageGrokResult);

  const stageDesk =
    opts.stageDesk ??
    productionAdapters?.stageDesk ??
    (async () => notConfiguredStage("desk") as StageDeskResult);

  const switchGrokRuntime =
    opts.switchGrokRuntime ??
    productionAdapters?.switchGrokRuntime ??
    (async (): Promise<SwitchRuntimeResult> => ({
      ok: false,
      code: "not_configured",
      message: "Grok runtime switch is not wired in this bootstrap",
    }));

  const restorePreviousRuntime =
    opts.restorePreviousRuntime ??
    productionAdapters?.restorePreviousRuntime;

  const installDeskOnRestart =
    opts.installDeskOnRestart ??
    productionAdapters?.installDeskOnRestart ??
    (async (): Promise<InstallDeskResult> => ({
      ok: false,
      code: "not_configured",
      message: "Desk install is not wired in this bootstrap",
    }));

  const updatesReady = Boolean(
    productionAdapters ||
      (opts.resolvePair &&
        opts.stageGrok &&
        opts.stageDesk &&
        opts.switchGrokRuntime &&
        opts.installDeskOnRestart),
  );
  let coordinator: UpdateCoordinator | null = null;
  let lastReadiness: RuntimeReadinessState;

  function buildRuntimeReadiness(): RuntimeReadinessState {
    const pointer = store.loadPointer();
    const verified = pointer.ok
      ? store.isCompleteVerifiedInstall(pointer.pointer.current)
      : null;
    const managedRuntimeReady = Boolean(verified?.ok);
    const admissionPaused = coordinator?.isAdmissionPaused() ?? false;
    const securityBlocked = coordinator?.isSecurityBlocked() ?? false;
    const reason: RuntimeReadinessState["reason"] = !managedRuntimeReady
      ? "managed_runtime_unavailable"
      : !updatesReady
        ? "update_readiness_unavailable"
        : securityBlocked
          ? "security_block"
          : admissionPaused
            ? "admission_paused"
            : "ready";
    return {
      schemaVersion: 1,
      managedRuntimeReady,
      updatesReady,
      admissionPaused,
      securityBlocked,
      reason,
      updatedAt: now().toISOString(),
    };
  }

  function writeRuntimeReadiness(): RuntimeReadinessState {
    const next = buildRuntimeReadiness();
    atomicWriteFile(readinessPath, `${JSON.stringify(next)}\n`);
    lastReadiness = next;
    return next;
  }

  coordinator = new UpdateCoordinator({
    journal,
    isIdle,
    getInstalled,
    getChannel: () => channel,
    getTarget: () => target,
    resolvePair,
    stageGrok,
    stageDesk,
    switchGrokRuntime,
    installDeskOnRestart,
    ...(restorePreviousRuntime ? { restorePreviousRuntime } : {}),
    health,
    now,
    onStatus: (status) => {
      writeRuntimeReadiness();
      opts.onStatus?.(status);
    },
  });
  lastReadiness = writeRuntimeReadiness();

  const onError =
    opts.onError ??
    ((err: unknown, ctx: string) => {
      console.error(`[update-bootstrap] ${ctx}`, err);
    });

  const scheduler = createUpdateScheduler({
    coordinator,
    intervalMs: opts.intervalMs,
    jitterFraction: opts.jitterFraction,
    random: opts.random,
    setTimeoutFn: opts.setTimeoutFn,
    clearTimeoutFn: opts.clearTimeoutFn,
    now: () => now().getTime(),
    onError,
  });

  function refreshManagedBinaryFromStore(): string | null {
    const p = store.loadPointer();
    if (!p.ok) {
      managedBinaryPath = applyManagedGrokBinaryEnv(null, env);
      writeRuntimeReadiness();
      return managedBinaryPath;
    }
    const verified = store.isCompleteVerifiedInstall(p.pointer.current);
    managedBinaryPath = applyManagedGrokBinaryEnv(
      verified.ok ? verified.binaryPath : null,
      env,
    );
    writeRuntimeReadiness();
    return managedBinaryPath;
  }

  return {
    runtimeRoot,
    store,
    journal,
    coordinator,
    scheduler,
    productionAdapters,
    recoveryNotes: recovery.notes,
    async start() {
      await scheduler.start();
      // Pointer may have been restored during coordinator recovery.
      refreshManagedBinaryFromStore();
    },
    stop() {
      scheduler.stop();
    },
    getManagedBinaryPath: () => managedBinaryPath,
    refreshManagedBinaryFromStore,
    getGrokOperationReadiness: () => ({
      ready: lastReadiness.reason === "ready",
      reason: lastReadiness.reason,
    }),
  };
}
