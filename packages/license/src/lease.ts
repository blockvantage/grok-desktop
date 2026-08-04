import type { KeyObject } from "node:crypto";
import * as jose from "jose";
import {
  resolvePublicKey,
  type PublicJwk,
} from "./key-ring.js";

/**
 * Device lease: compact JWS with
 *   protected header { alg: "EdDSA", typ: "grokdesk-lease+jwt", kid }
 *
 * Verify only — no lease issuance.
 */

export const LEASE_TYP = "grokdesk-lease+jwt";
export const LEASE_ALG = "EdDSA";
export const LEASE_PRODUCT_ID = "grok-desk";
export const LEASE_SEAT_LIMIT = 3;
export const LEASE_UPDATE_POLICY = "lifetime_stable";
export const LEASE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LEASE_REFRESH_AFTER_SECONDS = 24 * 60 * 60;

export type DeviceLeaseClaims = {
  iss: string;
  aud: string;
  entitlementId: string;
  activationId: string;
  deviceThumbprint: string;
  productId: typeof LEASE_PRODUCT_ID;
  capabilities: string[];
  seatLimit: typeof LEASE_SEAT_LIMIT;
  updatePolicy: typeof LEASE_UPDATE_POLICY;
  iat: number;
  refreshAfter: number;
  exp: number;
  jti: string;
};

export type DeviceLeaseVerifyOptions = {
  publicKey: KeyObject | PublicJwk;
  expectedIssuer: string;
  expectedAudience: string;
  expectedDeviceThumbprint?: string;
  nowSeconds?: number;
  clockToleranceSeconds?: number;
};

export type DeviceLeaseVerifyResult =
  | { ok: true; claims: DeviceLeaseClaims; header: jose.ProtectedHeaderParameters }
  | {
      ok: false;
      code:
        | "invalid_key_signature"
        | "lease_expired"
        | "lease_device_mismatch"
        | "device_deactivated"
        | "invalid_key_format"
        | "unknown_key";
      message: string;
    };

export async function verifyDeviceLease(
  token: string,
  options: DeviceLeaseVerifyOptions,
): Promise<DeviceLeaseVerifyResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 16_384) {
    return {
      ok: false,
      code: "invalid_key_format",
      message: "Lease token format invalid",
    };
  }

  let publicKey: KeyObject;
  try {
    publicKey = resolvePublicKey(options.publicKey);
  } catch {
    return {
      ok: false,
      code: "unknown_key",
      message: "Lease verification key invalid",
    };
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const clockTolerance = options.clockToleranceSeconds ?? 60;

  try {
    const { payload, protectedHeader } = await jose.jwtVerify(token, publicKey, {
      algorithms: [LEASE_ALG],
      issuer: options.expectedIssuer,
      audience: options.expectedAudience,
      currentDate: new Date(now * 1000),
      clockTolerance,
      typ: LEASE_TYP,
    });

    if (protectedHeader.alg !== LEASE_ALG || protectedHeader.typ !== LEASE_TYP) {
      return {
        ok: false,
        code: "invalid_key_format",
        message: "Lease header invalid",
      };
    }

    if (!protectedHeader.kid || typeof protectedHeader.kid !== "string") {
      return {
        ok: false,
        code: "invalid_key_format",
        message: "Lease kid missing",
      };
    }

    const claims = extractLeaseClaims(payload);
    if (!claims) {
      return {
        ok: false,
        code: "invalid_key_format",
        message: "Lease claims invalid",
      };
    }

    if (
      options.expectedDeviceThumbprint &&
      claims.deviceThumbprint !== options.expectedDeviceThumbprint
    ) {
      return {
        ok: false,
        code: "lease_device_mismatch",
        message: "Lease is not bound to this device",
      };
    }

    // jose already enforces exp, but surface a stable code if somehow present.
    if (typeof payload.exp === "number" && payload.exp + clockTolerance < now) {
      return {
        ok: false,
        code: "lease_expired",
        message: "Device lease has expired",
      };
    }

    return { ok: true, claims, header: protectedHeader };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/exp/i.test(message) || /timestamp check failed/i.test(message)) {
      return {
        ok: false,
        code: "lease_expired",
        message: "Device lease has expired",
      };
    }
    if (/signature/i.test(message) || /JWS/i.test(message)) {
      return {
        ok: false,
        code: "invalid_key_signature",
        message: "Lease signature is invalid",
      };
    }
    return {
      ok: false,
      code: "invalid_key_signature",
      message: "Lease verification failed",
    };
  }
}

/** @deprecated Prefer verifyDeviceLease — alias for plan naming. */
export const verifyLease = verifyDeviceLease;

function extractLeaseClaims(
  payload: jose.JWTPayload,
): DeviceLeaseClaims | null {
  const entitlementId = payload.entitlementId;
  const activationId = payload.activationId;
  const deviceThumbprint = payload.deviceThumbprint;
  const productId = payload.productId;
  const capabilities = payload.capabilities;
  const seatLimit = payload.seatLimit;
  const updatePolicy = payload.updatePolicy;
  const refreshAfter = payload.refreshAfter;
  const jti = payload.jti;
  const iss = payload.iss;
  const aud = payload.aud;
  const iat = payload.iat;
  const exp = payload.exp;

  if (
    typeof entitlementId !== "string" ||
    typeof activationId !== "string" ||
    typeof deviceThumbprint !== "string" ||
    productId !== LEASE_PRODUCT_ID ||
    !Array.isArray(capabilities) ||
    !capabilities.every((c) => typeof c === "string") ||
    seatLimit !== LEASE_SEAT_LIMIT ||
    updatePolicy !== LEASE_UPDATE_POLICY ||
    typeof refreshAfter !== "number" ||
    typeof jti !== "string" ||
    typeof iss !== "string" ||
    (typeof aud !== "string" &&
      !(Array.isArray(aud) && aud.length === 1 && typeof aud[0] === "string")) ||
    typeof iat !== "number" ||
    typeof exp !== "number"
  ) {
    return null;
  }

  const audience =
    typeof aud === "string"
      ? aud
      : Array.isArray(aud) && typeof aud[0] === "string"
        ? aud[0]
        : null;
  if (audience === null) {
    return null;
  }

  return {
    iss,
    aud: audience,
    entitlementId,
    activationId,
    deviceThumbprint,
    productId: LEASE_PRODUCT_ID,
    capabilities: capabilities as string[],
    seatLimit: LEASE_SEAT_LIMIT,
    updatePolicy: LEASE_UPDATE_POLICY,
    iat,
    refreshAfter,
    exp,
    jti,
  };
}
