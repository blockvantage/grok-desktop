/**
 * Main-process entitlement orchestrator: identity, activation, refresh, status.
 *
 * Initialize before gateway startup. Owns single-flight activation/refresh and
 * resolves lease verification keys from the entitlement well-known set.
 */

import type { KeyObject } from "node:crypto";
import {
  createEntitlementClient,
  type EntitlementClient,
} from "@grokdesk/entitlement-client";
import {
  deriveEntitlementState,
  importPublicJwk,
  rfc7638JwkThumbprint,
  type DeviceLeaseClaims,
  type PublicJwk,
} from "@grokdesk/license";
import type { DesktopLicenseState } from "@grokdesk/shared";
import {
  createActivationFlow,
  peekJwtKid,
  verifyReturnedLease,
  type ActivationFlow,
  type ActivationResult,
  type LeaseVerifyConfig,
  type PlatformInfo,
} from "./activation-flow.js";
import {
  loadOrCreateDeviceIdentity,
  type DeviceIdentity,
} from "./device-identity.js";
import {
  mapEntitlementError,
  recoveryActionForState,
  type MappedEntitlementError,
  type RecoveryAction,
} from "./error-map.js";
import {
  createRefreshLoop,
  type RefreshLoop,
  type RefreshResult,
} from "./refresh-loop.js";
import type { OsCredentialVault } from "./os-credential-vault.js";
import {
  getBuiltInLeasePublicJwks,
  mergeLeasePublicJwks,
} from "./lease-public-keys.js";
import {
  type AuthoritativeState,
  type EntitlementStateFile,
  type EntitlementStateStore,
} from "./state-store.js";
import { isCredentialStoreError } from "./types.js";

export type EntitlementManagerOptions = {
  vault: OsCredentialVault;
  stateStore: EntitlementStateStore;
  client: EntitlementClient;
  platform: PlatformInfo;
  expectedIssuer: string;
  expectedAudience: string;
  now?: () => Date;
  /** Test injection for timers / jitter. */
  refresh?: {
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
    randomUnit?: () => number;
  };
  onStatusChange?: (status: EntitlementStatus) => void;
  /**
   * DEV-ONLY unlock. When true, `getStatus()` reports a synthetic `active`
   * entitlement so local dev runs (`make local`) skip the activation wall. The
   * main process sets this ONLY for unpackaged DEV_UNLOCK or baked review builds,
   * so packaged builds can never enable it. It does not by itself grant Grok
   * admission — that is the gateway guard's job (also opened only in dev).
   */
  devUnlock?: boolean;
};

export type EntitlementStatus = {
  state: DesktopLicenseState;
  expiresAt: string | null;
  refreshAfter: string | null;
  deviceName: string;
  deviceId: string | null;
  activationId: string | null;
  recoveryAction: RecoveryAction;
  lastError: MappedEntitlementError | null;
  authoritativeState: AuthoritativeState;
};

export type EntitlementManager = {
  /** Load identity/state and run startup refresh when due. Call before gateway. */
  initialize: () => Promise<EntitlementStatus>;
  activate: (productKeyInput: string) => Promise<ActivationResult>;
  refresh: () => Promise<RefreshResult>;
  getStatus: () => Promise<EntitlementStatus>;
  stop: () => void;
  getIdentity: () => Promise<DeviceIdentity>;
  /** Absolute path of the entitlement state file (for gateway env). */
  statePath: string;
  /**
   * Public lease-signing JWKs for the gateway (no private material).
   * Empty when the well-known key ring could not be fetched yet.
   */
  getLeasePublicJwksForGateway: () => Promise<PublicJwk[]>;
};

/**
 * Create a configured EntitlementClient for production main process.
 */
export function createDesktopEntitlementClient(input: {
  baseUrl: URL | string;
  deskVersion: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): EntitlementClient {
  const baseUrl =
    typeof input.baseUrl === "string" ? new URL(input.baseUrl) : input.baseUrl;
  return createEntitlementClient({
    baseUrl,
    userAgent: `GrokDesk/${input.deskVersion}`,
    fetch: input.fetch,
    timeoutMs: input.timeoutMs,
  });
}

export function createEntitlementManager(
  options: EntitlementManagerOptions,
): EntitlementManager {
  const nowFn = options.now ?? (() => new Date());
  let identity: DeviceIdentity | null = null;
  /** In-flight identity load, so concurrent callers share one create. */
  let identityPromise: Promise<DeviceIdentity> | null = null;
  let lastError: MappedEntitlementError | null = null;
  let lastClaims: DeviceLeaseClaims | null = null;
  let networkError = false;
  let keyRing: Map<string, PublicJwk> | null = null;
  let keyRingFetchedAt = 0;

  const leaseVerify: LeaseVerifyConfig = {
    expectedIssuer: options.expectedIssuer,
    expectedAudience: options.expectedAudience,
    resolveLeasePublicKey: async (kid) => {
      const ring = await ensureKeyRing();
      return ring.get(kid) ?? null;
    },
  };

  function bakedKeyRing(): Map<string, PublicJwk> {
    const map = new Map<string, PublicJwk>();
    for (const jwk of getBuiltInLeasePublicJwks()) {
      if (jwk.kid) map.set(jwk.kid, jwk);
    }
    return map;
  }

  async function ensureKeyRing(force = false): Promise<Map<string, PublicJwk>> {
    const age = Date.now() - keyRingFetchedAt;
    if (!force && keyRing && age < 60 * 60 * 1000) {
      return keyRing;
    }
    // Seed with build-time/env public lease keys so offline cold-start can
    // verify signed 30-day leases without a well-known fetch.
    const baked = Array.from(bakedKeyRing().values());
    const fetched: PublicJwk[] = [];
    try {
      const set = await options.client.getWellKnownGrokdeskKeys();
      for (const key of set.keys) {
        if (
          key.kty === "OKP" &&
          key.crv === "Ed25519" &&
          typeof key.x === "string" &&
          typeof key.kid === "string"
        ) {
          fetched.push({
            kty: "OKP",
            crv: "Ed25519",
            x: key.x,
            kid: key.kid,
            alg: key.alg,
            use: key.use,
          });
        }
      }
    } catch {
      // Network/offline: keep baked (and any prior cache). Empty baked leaves
      // fail-closed verify (no kid resolves) — not unlicensed Grok work.
      if (baked.length === 0 && keyRing) {
        return keyRing;
      }
    }
    const trusted = mergeLeasePublicJwks(baked, fetched);
    const map = new Map<string, PublicJwk>();
    for (const jwk of trusted) {
      if (jwk.kid) map.set(jwk.kid, jwk);
    }
    keyRing = map;
    keyRingFetchedAt = Date.now();
    return map;
  }

  async function getIdentity(): Promise<DeviceIdentity> {
    if (identity) return identity;
    // Single-flight: two callers racing before the first load resolves must
    // share one `loadOrCreateDeviceIdentity`, or both would mint an identity
    // and write it (last-write-wins churn). Reset on failure so a later call
    // can retry rather than being wedged to a rejected promise.
    if (!identityPromise) {
      identityPromise = loadOrCreateDeviceIdentity(options.vault, {
        hasLease: async () => {
          const s = await options.stateStore.read();
          return Boolean(s?.lease);
        },
        now: nowFn,
      }).then(
        (id) => {
          identity = id;
          return id;
        },
        (err) => {
          identityPromise = null;
          throw err;
        },
      );
    }
    return identityPromise;
  }

  async function loadVerifiedClaims(): Promise<DeviceLeaseClaims | null> {
    const state = await options.stateStore.read();
    if (!state?.lease) {
      lastClaims = null;
      return null;
    }
    const id = await getIdentity();
    const thumbprint = rfc7638JwkThumbprint(id.publicJwk);
    // Prefer stored thumbprint when present.
    const expected = state.devicePublicKeyThumbprint || thumbprint;
    const nowSeconds = Math.floor(nowFn().getTime() / 1000);
    try {
      await ensureKeyRing();
    } catch {
      // Offline: ensureKeyRing already falls back to baked public keys.
      if (!keyRing || keyRing.size === 0) {
        lastClaims = null;
        return null;
      }
    }
    const verified = await verifyReturnedLease(
      state.lease,
      leaseVerify,
      expected,
      nowSeconds,
    );
    if (!verified.ok) {
      lastClaims = null;
      return null;
    }
    lastClaims = verified.claims;
    return verified.claims;
  }

  function denialFromState(
    authoritativeState: AuthoritativeState,
  ):
    | {
        code:
          | "entitlement_suspended"
          | "entitlement_refunded"
          | "entitlement_revoked"
          | "device_deactivated";
      }
    | null {
    switch (authoritativeState) {
      case "suspended":
        return { code: "entitlement_suspended" };
      case "refunded":
        return { code: "entitlement_refunded" };
      case "revoked":
        return { code: "entitlement_revoked" };
      case "device_deactivated":
        return { code: "device_deactivated" };
      default:
        return null;
    }
  }

  async function computeStatus(): Promise<EntitlementStatus> {
    // DEV-ONLY unlock (gated upstream: unpackaged DEV_UNLOCK or bake flag):
    // report a synthetic active entitlement so `make local` skips the activation
    // wall. Never reachable in a packaged build. Identity is best-effort — the
    // unlock must not depend on the credential vault being available in dev.
    if (options.devUnlock) {
      let devName = "Grok Desk (dev unlock)";
      let devId: string | null = null;
      try {
        const id = await getIdentity();
        devName = id.displayName;
        devId = id.deviceId;
      } catch {
        /* identity best-effort in dev-unlock */
      }
      return {
        state: "active",
        expiresAt: null,
        refreshAfter: null,
        deviceName: devName,
        deviceId: devId,
        activationId: "dev-unlock",
        recoveryAction: "none",
        lastError: null,
        authoritativeState: "none",
      };
    }

    let deviceName = "Grok Desk";
    let deviceId: string | null = null;
    try {
      const id = await getIdentity();
      deviceName = id.displayName;
      deviceId = id.deviceId;
    } catch (err) {
      if (isCredentialStoreError(err)) {
        const mapped = mapEntitlementError(err);
        lastError = mapped;
        return {
          state: "credential_store_failure",
          expiresAt: null,
          refreshAfter: null,
          deviceName,
          deviceId: null,
          activationId: null,
          recoveryAction: "credential_help",
          lastError: mapped,
          authoritativeState: "none",
        };
      }
      throw err;
    }

    const stateFile = await options.stateStore.read();
    const claims = await loadVerifiedClaims();
    const denial = stateFile
      ? denialFromState(stateFile.authoritativeState)
      : null;

    // Activation outcomes without a lease (e.g. seat_limit) must surface
    // through status even though no claims exist yet.
    if (
      !claims &&
      !denial &&
      lastError &&
      (lastError.code === "seat_limit" ||
        lastError.code === "entitlement_suspended" ||
        lastError.code === "entitlement_refunded" ||
        lastError.code === "entitlement_revoked" ||
        lastError.code === "device_deactivated" ||
        lastError.code === "key_rotated" ||
        lastError.code === "unsupported_client" ||
        lastError.code === "unsupported_architecture")
    ) {
      return {
        state: lastError.state,
        expiresAt: null,
        refreshAfter: null,
        deviceName,
        deviceId,
        activationId: null,
        recoveryAction: lastError.recoveryAction,
        lastError,
        authoritativeState: stateFile?.authoritativeState ?? "none",
      };
    }

    const decision = deriveEntitlementState({
      claims,
      denial,
      networkError: networkError && !denial,
      nowSeconds: Math.floor(nowFn().getTime() / 1000),
    });

    const state = decision.state;
    const recoveryAction =
      lastError && state === lastError.state
        ? lastError.recoveryAction
        : recoveryActionForState(state);

    return {
      state,
      expiresAt: claims
        ? new Date(claims.exp * 1000).toISOString()
        : null,
      refreshAfter: claims
        ? new Date(claims.refreshAfter * 1000).toISOString()
        : null,
      deviceName,
      deviceId,
      activationId: claims?.activationId ?? null,
      recoveryAction,
      lastError:
        decision.ok === false
          ? lastError && lastError.state === state
            ? lastError
            : mapEntitlementError({ code: decision.code })
          : networkError
            ? lastError
            : null,
      authoritativeState: stateFile?.authoritativeState ?? "none",
    };
  }

  const activation: ActivationFlow = createActivationFlow({
    client: options.client,
    vault: options.vault,
    stateStore: options.stateStore,
    getIdentity,
    platform: options.platform,
    leaseVerify,
    now: nowFn,
  });

  const refreshLoop: RefreshLoop = createRefreshLoop({
    client: options.client,
    stateStore: options.stateStore,
    getIdentity,
    leaseVerify,
    loadVerifiedClaims,
    now: nowFn,
    setTimer: options.refresh?.setTimer,
    clearTimer: options.refresh?.clearTimer,
    randomUnit: options.refresh?.randomUnit,
    onStateChange: () => {
      void computeStatus().then((s) => options.onStatusChange?.(s));
    },
  });

  return {
    statePath: options.stateStore.path,

    async initialize(): Promise<EntitlementStatus> {
      try {
        await getIdentity();
        try {
          await ensureKeyRing(true);
        } catch (err) {
          // Keys unavailable at startup is non-fatal if a lease already verifies later offline.
          lastError = mapEntitlementError(err);
          networkError = true;
        }
        const refreshResult = await refreshLoop.initialize();
        if (refreshResult) {
          if (refreshResult.ok) {
            networkError = false;
            lastError = null;
            lastClaims = refreshResult.claims;
          } else {
            lastError = refreshResult.error;
            networkError = refreshResult.preservedLease;
          }
        }
      } catch (err) {
        lastError = mapEntitlementError(err);
      }
      const status = await computeStatus();
      options.onStatusChange?.(status);
      return status;
    },

    async activate(productKeyInput: string): Promise<ActivationResult> {
      const result = await activation.activate(productKeyInput);
      if (result.ok) {
        networkError = false;
        lastError = null;
        lastClaims = result.claims;
        refreshLoop.scheduleFromClaims(result.claims);
      } else {
        lastError = result.error;
        if (result.error.code === "service_unavailable") {
          networkError = true;
        }
      }
      const status = await computeStatus();
      options.onStatusChange?.(status);
      return result;
    },

    async refresh(): Promise<RefreshResult> {
      const result = await refreshLoop.refreshNow();
      if (result.ok) {
        networkError = false;
        lastError = null;
        lastClaims = result.claims;
        refreshLoop.scheduleFromClaims(result.claims);
      } else {
        lastError = result.error;
        networkError = result.preservedLease;
      }
      const status = await computeStatus();
      options.onStatusChange?.(status);
      return result;
    },

    getStatus: computeStatus,

    stop() {
      refreshLoop.stop();
    },

    getIdentity,

    async getLeasePublicJwksForGateway(): Promise<PublicJwk[]> {
      const baked = getBuiltInLeasePublicJwks();
      const toPublic = (jwk: PublicJwk): PublicJwk => ({
        kty: "OKP" as const,
        crv: "Ed25519" as const,
        x: jwk.x,
        kid: jwk.kid,
        ...(jwk.alg ? { alg: jwk.alg } : {}),
        ...(jwk.use ? { use: jwk.use } : {}),
      });
      try {
        const ring = await ensureKeyRing();
        const fetched = Array.from(ring.values()).map(toPublic);
        // Fetched kids override baked when both present (rotation overlap).
        return mergeLeasePublicJwks(baked, fetched);
      } catch {
        // Offline / keys not yet available: prefer cached well-known + baked.
        if (keyRing) {
          return mergeLeasePublicJwks(
            baked,
            Array.from(keyRing.values()).map(toPublic),
          );
        }
        // Never fail-open with empty ring when baked keys exist. Empty baked
        // still allows gateway FAIL_CLOSED deny-all (no unlicensed Grok work).
        return baked;
      }
    },
  };
}

/** Re-export helpers tests may need when resolving keys. */
export function publicJwkToKeyObject(jwk: PublicJwk): KeyObject {
  return importPublicJwk(jwk);
}

export { peekJwtKid };
export type { EntitlementStateFile, DeviceLeaseClaims };
