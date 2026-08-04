/**
 * GD3 device activation: challenge → signed proof → lease verify → vault/state.
 *
 * Safety:
 * - Never stores an invalid product key.
 * - seat_limit proves a valid current key → store key for retry.
 * - Lease must verify locally before state write.
 * - Single-flight against double-click / concurrent activate.
 */

import { sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  EntitlementApiError,
  type EntitlementClient,
} from "@grokdesk/entitlement-client";
import {
  ACTIVATE_PREFIX,
  base64urlEncode,
  buildProofSigningMaterial,
  extractGd3,
  rfc7638JwkThumbprint,
  verifyDeviceLease,
  type ActivationProofPayload,
  type DeviceLeaseClaims,
  type PublicJwk,
} from "@grokdesk/license";
import type { DeviceIdentity } from "./device-identity.js";
import {
  mapEntitlementError,
  type MappedEntitlementError,
} from "./error-map.js";
import type { OsCredentialVault } from "./os-credential-vault.js";
import {
  type EntitlementStateFile,
  type EntitlementStateStore,
} from "./state-store.js";
import { PRODUCT_KEY_ACCOUNT } from "./types.js";

export type PlatformInfo = {
  platform: string;
  arch: string;
  osVersion: string;
  deskVersion: string;
};

export type LeaseVerifyConfig = {
  expectedIssuer: string;
  expectedAudience: string;
  /** Resolve lease verification public key by kid (from well-known set). */
  resolveLeasePublicKey: (
    kid: string,
  ) => Promise<KeyObject | PublicJwk | null> | KeyObject | PublicJwk | null;
  clockToleranceSeconds?: number;
};

export type ActivationFlowDeps = {
  client: EntitlementClient;
  vault: OsCredentialVault;
  stateStore: EntitlementStateStore;
  getIdentity: () => Promise<DeviceIdentity>;
  platform: PlatformInfo;
  leaseVerify: LeaseVerifyConfig;
  now?: () => Date;
};

export type ActivationSuccess = {
  ok: true;
  claims: DeviceLeaseClaims;
  state: EntitlementStateFile;
  activationId: string;
  entitlementId: string;
  seatSlot: number;
};

export type ActivationFailure = {
  ok: false;
  error: MappedEntitlementError;
  /** True when a cryptographically/server-valid key was retained for retry. */
  keyStored: boolean;
};

export type ActivationResult = ActivationSuccess | ActivationFailure;

export type ActivationFlow = {
  activate: (productKeyInput: string) => Promise<ActivationResult>;
  /** True while an activation is in flight. */
  isInFlight: () => boolean;
};

/**
 * Sign the contract activation proof with the device private key.
 */
export function signActivationProof(
  privateKey: KeyObject,
  payload: ActivationProofPayload,
): string {
  const material = buildProofSigningMaterial(ACTIVATE_PREFIX, payload);
  const signature = cryptoSign(null, material.signingBytes, privateKey);
  return base64urlEncode(signature);
}

export function buildActivationPayload(input: {
  challengeId: string;
  nonce: string;
  identity: DeviceIdentity;
  platform: PlatformInfo;
}): ActivationProofPayload {
  return {
    challengeId: input.challengeId,
    nonce: input.nonce,
    deviceId: input.identity.deviceId,
    devicePublicJwk: {
      kty: "OKP",
      crv: "Ed25519",
      x: input.identity.publicJwk.x,
    },
    deviceName: input.identity.displayName,
    platform: input.platform.platform,
    arch: input.platform.arch,
    osVersion: input.platform.osVersion,
    deskVersion: input.platform.deskVersion,
  };
}

/** Max compact JWS size accepted for kid peek (matches lease verify bounds). */
export const PEEK_JWT_MAX_CHARS = 16_384;

/** Decode compact JWS protected header kid without verifying. */
export function peekJwtKid(token: string): string | null {
  if (typeof token !== "string" || token.length === 0) return null;
  if (token.length > PEEK_JWT_MAX_CHARS) return null;
  const parts = token.split(".");
  if (parts.length < 2 || parts.length > 5) return null;
  // Header segment alone should be tiny (kid/alg only).
  if (parts[0]!.length > 512) return null;
  try {
    const headerJson = Buffer.from(parts[0]!, "base64url").toString("utf8");
    if (headerJson.length > 1_024) return null;
    const header = JSON.parse(headerJson) as { kid?: unknown };
    return typeof header.kid === "string" &&
      header.kid.length > 0 &&
      header.kid.length <= 256
      ? header.kid
      : null;
  } catch {
    return null;
  }
}

export async function verifyReturnedLease(
  lease: string,
  config: LeaseVerifyConfig,
  expectedDeviceThumbprint: string,
  nowSeconds: number,
): Promise<
  | { ok: true; claims: DeviceLeaseClaims }
  | { ok: false; code: string }
> {
  const kid = peekJwtKid(lease);
  if (!kid) {
    return { ok: false, code: "invalid_key_format" };
  }
  const publicKey = await config.resolveLeasePublicKey(kid);
  if (!publicKey) {
    return { ok: false, code: "unknown_key" };
  }
  const result = await verifyDeviceLease(lease, {
    publicKey,
    expectedIssuer: config.expectedIssuer,
    expectedAudience: config.expectedAudience,
    expectedDeviceThumbprint,
    nowSeconds,
    clockToleranceSeconds: config.clockToleranceSeconds ?? 60,
  });
  if (!result.ok) {
    return { ok: false, code: result.code };
  }
  return { ok: true, claims: result.claims };
}

/**
 * Create a single-flight activation flow bound to the given deps.
 */
export function createActivationFlow(deps: ActivationFlowDeps): ActivationFlow {
  let inFlight: Promise<ActivationResult> | null = null;

  async function runActivate(productKeyInput: string): Promise<ActivationResult> {
    let gd3: string;
    try {
      gd3 = extractGd3(productKeyInput);
    } catch (err) {
      return {
        ok: false,
        error: mapEntitlementError(err),
        keyStored: false,
      };
    }

    const identity = await deps.getIdentity();
    const thumbprint = rfc7638JwkThumbprint(identity.publicJwk);
    const now = deps.now?.() ?? new Date();

    let challenge: {
      challengeId: string;
      nonce: string;
      expiresAt: string;
      serverTime: string;
    };
    try {
      challenge = await deps.client.createActivationChallenge({
        deskVersion: deps.platform.deskVersion,
        platform: deps.platform.platform,
        arch: deps.platform.arch,
      });
    } catch (err) {
      return {
        ok: false,
        error: mapEntitlementError(err),
        keyStored: false,
      };
    }

    const payload = buildActivationPayload({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      identity,
      platform: deps.platform,
    });
    const signature = signActivationProof(identity.privateKey, payload);

    let response: {
      activationId: string;
      entitlementId: string;
      seatSlot: number;
      lease: string;
      serverTime: string;
    };
    try {
      response = await deps.client.createActivation({
        productKey: gd3,
        challengeId: challenge.challengeId,
        deviceId: identity.deviceId,
        devicePublicJwk: payload.devicePublicJwk,
        deviceName: payload.deviceName,
        platform: payload.platform,
        arch: payload.arch,
        osVersion: payload.osVersion,
        deskVersion: payload.deskVersion,
        signature,
      });
    } catch (err) {
      // seat_limit proves a valid current key — retain for portal retry.
      if (
        err instanceof EntitlementApiError &&
        err.code === "seat_limit"
      ) {
        await deps.vault.set(PRODUCT_KEY_ACCOUNT, gd3);
        return {
          ok: false,
          error: mapEntitlementError(err),
          keyStored: true,
        };
      }
      // Do not store invalid or denied keys.
      return {
        ok: false,
        error: mapEntitlementError(err),
        keyStored: false,
      };
    }

    const nowSeconds = Math.floor(
      (Date.parse(response.serverTime) || now.getTime()) / 1000,
    );
    const verified = await verifyReturnedLease(
      response.lease,
      deps.leaseVerify,
      thumbprint,
      nowSeconds,
    );
    if (!verified.ok) {
      // Lease failed local verify — never store key or state.
      return {
        ok: false,
        error: mapEntitlementError({
          code:
            verified.code === "lease_device_mismatch"
              ? "lease_device_mismatch"
              : verified.code === "lease_expired"
                ? "lease_expired"
                : "invalid_key_signature",
        }),
        keyStored: false,
      };
    }

    // Verified lease + server acceptance ⇒ store key then state.
    await deps.vault.set(PRODUCT_KEY_ACCOUNT, gd3);

    const state: EntitlementStateFile = {
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: thumbprint,
      lease: response.lease,
      authoritativeState: "none",
      updatedAt: now.toISOString(),
      requestId: deps.client.diagnostics().lastRequestId ?? null,
    };
    await deps.stateStore.write(state);

    return {
      ok: true,
      claims: verified.claims,
      state,
      activationId: response.activationId,
      entitlementId: response.entitlementId,
      seatSlot: response.seatSlot,
    };
  }

  return {
    isInFlight: () => inFlight !== null,
    activate: (productKeyInput: string) => {
      if (inFlight) return inFlight;
      inFlight = runActivate(productKeyInput).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
