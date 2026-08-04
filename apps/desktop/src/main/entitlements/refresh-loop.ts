/**
 * Lease refresh policy: startup check, 24h ±10% jitter, single-flight.
 *
 * Never extends lease `exp` locally. Network/5xx/429 preserve a still-valid
 * lease; authoritative denials are written immediately.
 */

import { sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  EntitlementApiError,
  type EntitlementClient,
} from "@grokdesk/entitlement-client";
import {
  base64urlEncode,
  buildProofSigningMaterial,
  LEASE_REFRESH_PREFIX,
  rfc7638JwkThumbprint,
  type DeviceLeaseClaims,
  type LeaseRefreshProofPayload,
} from "@grokdesk/license";
import type { DeviceIdentity } from "./device-identity.js";
import {
  denialCodeToAuthoritativeState,
  isAuthoritativeDenialCode,
  mapEntitlementError,
  type MappedEntitlementError,
} from "./error-map.js";
import {
  verifyReturnedLease,
  type LeaseVerifyConfig,
} from "./activation-flow.js";
import type { EntitlementStateStore } from "./state-store.js";

/** Nominal refresh period used for jitter amplitude (24 hours). */
export const REFRESH_PERIOD_MS = 24 * 60 * 60 * 1000;

/** ±10% of the 24h period. */
export const REFRESH_JITTER_FRACTION = 0.1;

export type RefreshLoopDeps = {
  client: EntitlementClient;
  stateStore: EntitlementStateStore;
  getIdentity: () => Promise<DeviceIdentity>;
  leaseVerify: LeaseVerifyConfig;
  /**
   * Parse and cryptographically verify the current on-disk lease.
   * Returns null when absent or invalid.
   */
  loadVerifiedClaims: () => Promise<DeviceLeaseClaims | null>;
  now?: () => Date;
  /** Injected for tests; defaults to setTimeout. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Injected jitter in [-1, 1]; defaults to Math.random()*2-1. */
  randomUnit?: () => number;
  onStateChange?: () => void;
};

export type RefreshSuccess = {
  ok: true;
  claims: DeviceLeaseClaims;
  lease: string;
};

export type RefreshFailure = {
  ok: false;
  error: MappedEntitlementError;
  /** Still-valid lease preserved through transient failure. */
  preservedLease: boolean;
  /** Authoritative denial was written to state. */
  denialApplied: boolean;
};

export type RefreshResult = RefreshSuccess | RefreshFailure;

export type RefreshLoop = {
  /** Call before gateway startup; refreshes when now >= refreshAfter. */
  initialize: () => Promise<RefreshResult | null>;
  /** Schedule the next refresh relative to claims.refreshAfter. */
  scheduleFromClaims: (claims: DeviceLeaseClaims) => void;
  /** Cancel scheduled timer. */
  stop: () => void;
  /** Force a refresh (single-flight). */
  refreshNow: () => Promise<RefreshResult>;
  isInFlight: () => boolean;
  /** Next scheduled fire time (ms since epoch), or null. */
  nextFireAtMs: () => number | null;
};

export function signLeaseRefreshProof(
  privateKey: KeyObject,
  payload: LeaseRefreshProofPayload,
): string {
  const material = buildProofSigningMaterial(LEASE_REFRESH_PREFIX, payload);
  const signature = cryptoSign(null, material.signingBytes, privateKey);
  return base64urlEncode(signature);
}

/**
 * Compute delay until refreshAfter with ±10% of 24h jitter.
 * Never returns a negative delay less than 0 (fire ASAP when overdue).
 */
export function computeRefreshDelayMs(
  refreshAfterSeconds: number,
  nowMs: number,
  randomUnit: () => number = () => Math.random() * 2 - 1,
): number {
  const targetMs = refreshAfterSeconds * 1000;
  const jitterMs =
    randomUnit() * REFRESH_JITTER_FRACTION * REFRESH_PERIOD_MS;
  const fireAt = targetMs + jitterMs;
  return Math.max(0, fireAt - nowMs);
}

export function createRefreshLoop(deps: RefreshLoopDeps): RefreshLoop {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const randomUnit = deps.randomUnit ?? (() => Math.random() * 2 - 1);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextFireAt: number | null = null;
  let inFlight: Promise<RefreshResult> | null = null;

  function stop(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    nextFireAt = null;
  }

  function scheduleFromClaims(claims: DeviceLeaseClaims): void {
    stop();
    const now = deps.now?.() ?? new Date();
    const delay = computeRefreshDelayMs(
      claims.refreshAfter,
      now.getTime(),
      randomUnit,
    );
    nextFireAt = now.getTime() + delay;
    timer = setTimer(() => {
      timer = null;
      nextFireAt = null;
      void refreshNow().then((result) => {
        if (result.ok) {
          scheduleFromClaims(result.claims);
        } else if (result.preservedLease) {
          // Retry with bounded backoff-ish: re-schedule using original refreshAfter
          // plus a fresh jitter so we keep trying without extending exp.
          scheduleFromClaims(claims);
        }
      });
    }, delay);
  }

  async function performRefresh(): Promise<RefreshResult> {
    const identity = await deps.getIdentity();
    const thumbprint = rfc7638JwkThumbprint(identity.publicJwk);
    const now = deps.now?.() ?? new Date();
    const claims = await deps.loadVerifiedClaims();

    if (!claims) {
      return {
        ok: false,
        error: mapEntitlementError({ code: "lease_expired" }),
        preservedLease: false,
        denialApplied: false,
      };
    }

    // Do not attempt network refresh after hard expiry — exp is authoritative.
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (claims.exp <= nowSeconds) {
      return {
        ok: false,
        error: mapEntitlementError({ code: "lease_expired" }),
        preservedLease: false,
        denialApplied: false,
      };
    }

    let challenge: {
      challengeId: string;
      nonce: string;
      expiresAt: string;
      serverTime: string;
    };
    try {
      challenge = await deps.client.createLeaseChallenge({
        activationId: claims.activationId,
        deviceId: identity.deviceId,
      });
    } catch (err) {
      return await handleRefreshFailure(err, identity, thumbprint, now, true);
    }

    const payload: LeaseRefreshProofPayload = {
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      deviceId: identity.deviceId,
      activationId: claims.activationId,
      devicePublicJwk: {
        kty: "OKP",
        crv: "Ed25519",
        x: identity.publicJwk.x,
      },
      priorLeaseJti: claims.jti,
    };
    const signature = signLeaseRefreshProof(identity.privateKey, payload);

    let response: { lease: string; serverTime: string };
    try {
      response = await deps.client.refreshLease({
        challengeId: challenge.challengeId,
        activationId: claims.activationId,
        deviceId: identity.deviceId,
        priorLeaseJti: claims.jti,
        signature,
      });
    } catch (err) {
      return await handleRefreshFailure(err, identity, thumbprint, now, true);
    }

    const serverNowSeconds = Math.floor(
      (Date.parse(response.serverTime) || now.getTime()) / 1000,
    );
    const verified = await verifyReturnedLease(
      response.lease,
      deps.leaseVerify,
      thumbprint,
      serverNowSeconds,
    );
    if (!verified.ok) {
      // Bad lease from server — preserve previous valid lease; do not extend exp.
      await deps.stateStore.writeTransientRefreshFailure({
        updatedAt: now.toISOString(),
        requestId: deps.client.diagnostics().lastRequestId ?? null,
        deviceId: identity.deviceId,
        devicePublicKeyThumbprint: thumbprint,
      });
      deps.onStateChange?.();
      return {
        ok: false,
        error: mapEntitlementError({
          code:
            verified.code === "lease_device_mismatch"
              ? "lease_device_mismatch"
              : "invalid_key_signature",
        }),
        preservedLease: true,
        denialApplied: false,
      };
    }

    // Replace the full signed lease token only after local verify.
    // Never mutate exp/refreshAfter on a prior token in place.
    await deps.stateStore.write({
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: thumbprint,
      lease: response.lease,
      authoritativeState: "none",
      updatedAt: now.toISOString(),
      requestId: deps.client.diagnostics().lastRequestId ?? null,
    });
    deps.onStateChange?.();

    return {
      ok: true,
      claims: verified.claims,
      lease: response.lease,
    };
  }

  async function handleRefreshFailure(
    err: unknown,
    identity: DeviceIdentity,
    thumbprint: string,
    now: Date,
    hadValidClaims: boolean,
  ): Promise<RefreshFailure> {
    const mapped = mapEntitlementError(err);
    const requestId =
      err instanceof EntitlementApiError
        ? err.requestId ?? null
        : mapped.requestId ?? null;

    if (isAuthoritativeDenialCode(mapped.code)) {
      const prev = await deps.stateStore.read();
      await deps.stateStore.write({
        schema: 1,
        deviceId: identity.deviceId,
        devicePublicKeyThumbprint: thumbprint,
        // Keep previous lease bytes for audit/local expiry; denial takes UX precedence.
        lease: prev?.lease ?? null,
        authoritativeState: denialCodeToAuthoritativeState(mapped.code),
        updatedAt: now.toISOString(),
        requestId,
      });
      deps.onStateChange?.();
      return {
        ok: false,
        error: mapped,
        preservedLease: Boolean(prev?.lease),
        denialApplied: true,
      };
    }

    // Transient: timeout / network / 5xx / 429 — preserve lease, no exp mutation.
    if (hadValidClaims) {
      await deps.stateStore.writeTransientRefreshFailure({
        updatedAt: now.toISOString(),
        requestId,
        deviceId: identity.deviceId,
        devicePublicKeyThumbprint: thumbprint,
      });
      deps.onStateChange?.();
      return {
        ok: false,
        error: mapEntitlementError({
          code: "service_unavailable",
          retryable: true,
          requestId: requestId ?? undefined,
        }),
        preservedLease: true,
        denialApplied: false,
      };
    }

    return {
      ok: false,
      error: mapped,
      preservedLease: false,
      denialApplied: false,
    };
  }

  function refreshNow(): Promise<RefreshResult> {
    if (inFlight) return inFlight;
    inFlight = performRefresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function initialize(): Promise<RefreshResult | null> {
    const claims = await deps.loadVerifiedClaims();
    if (!claims) return null;

    const now = deps.now?.() ?? new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);

    if (nowSeconds >= claims.refreshAfter) {
      const result = await refreshNow();
      if (result.ok) {
        scheduleFromClaims(result.claims);
      } else if (result.preservedLease) {
        scheduleFromClaims(claims);
      }
      return result;
    }

    scheduleFromClaims(claims);
    return null;
  }

  return {
    initialize,
    scheduleFromClaims,
    stop,
    refreshNow,
    isInFlight: () => inFlight !== null,
    nextFireAtMs: () => nextFireAt,
  };
}

