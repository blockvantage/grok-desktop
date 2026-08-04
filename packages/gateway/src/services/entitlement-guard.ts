/**
 * Shared gateway entitlement enforcement boundary (Task 8).
 *
 * Independently verifies a server-signed device lease from the atomic state
 * file (or injected claims) before Grok-backed operations. Local read/export/
 * manage/recovery remain allowed when the lease is invalid.
 *
 * Integration: call `assertCapability("grok_operation", action)` at admission
 * and last-inference boundaries. Host-bridge / index can import
 * `createEntitlementGuard` later without product keys in the gateway.
 */

import type { KeyObject } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import {
  deriveEntitlementState,
  verifyDeviceLease,
  type DeviceLeaseClaims,
  type PublicJwk,
} from "@grokdesk/license";
import {
  GROK_OPERATION_ALLOWED_STATES,
  type DesktopLicenseState,
  type EntitlementCapabilityCategory,
  type StableErrorCode,
} from "@grokdesk/shared";
import {
  EntitlementReadOnlyError,
  isEntitlementReadOnlyError,
  type EntitlementDenialCode,
} from "./entitlement-error.js";

export {
  EntitlementReadOnlyError,
  isEntitlementReadOnlyError,
  ENTITLEMENT_READ_ONLY_CODE,
  type EntitlementDenialCode,
  type EntitlementReadOnlyCode,
  type EntitlementReadOnlyErrorInit,
} from "./entitlement-error.js";

/** Authoritative denial persisted by Electron main (safe; no secrets). */
export type AuthoritativeState =
  | "none"
  | "suspended"
  | "refunded"
  | "revoked"
  | "device_deactivated";

/**
 * Minimal state envelope written by main and read by the gateway.
 * Shape matches `apps/desktop/.../state-store.ts` EntitlementStateFile.
 */
export type EntitlementStateEnvelope = {
  schema?: 1;
  deviceId: string;
  devicePublicKeyThumbprint: string;
  lease: string | null;
  authoritativeState: AuthoritativeState;
  updatedAt?: string;
  requestId?: string | null;
};

export type EntitlementKeyRing =
  | PublicJwk
  | KeyObject
  | ReadonlyMap<string, PublicJwk | KeyObject>;

export type EntitlementGuardOptions = {
  /**
   * Absolute path of the atomic entitlement state file
   * (`GROKDESK_ENTITLEMENT_STATE_PATH`). Optional when `loadState` / inject is used.
   */
  statePath?: string | null;
  /**
   * Bundled trusted lease-signing public key(s). Network-fetched keys must not
   * be trusted without chain validation elsewhere; pass only the release-bundled ring.
   */
  keyRing: EntitlementKeyRing;
  expectedIssuer: string;
  expectedAudience: string;
  /** Unix seconds clock (injectable for tests). */
  nowSeconds?: () => number;
  clockToleranceSeconds?: number;
  /**
   * Inject or override state loading (tests / process wiring).
   * When provided, it is the sole source of state (statePath is not read).
   */
  loadState?: () =>
    | EntitlementStateEnvelope
    | null
    | Promise<EntitlementStateEnvelope | null>;
  /**
   * Inject already-verified claims (unit tests). Skips JWS verification when set
   * to a claims object; `null` means "no verified claims".
   */
  injectVerifiedClaims?: DeviceLeaseClaims | null;
  /**
   * Lease capability string required for `grok_operation`.
   * Defaults to `grok-runtime` (contract vectors).
   */
  requiredGrokCapability?: string;
  /** Max state file size in bytes (default 64 KiB). */
  maxStateBytes?: number;
};

export type EntitlementGuardSnapshot = {
  state: DesktopLicenseState;
  grokAllowed: boolean;
  hasVerifiedLease: boolean;
  evaluatedAtSeconds: number;
  /** Safe underlying denial when grok is blocked. */
  denialCode?: EntitlementDenialCode;
};

export type EntitlementGuardCheck =
  | {
      ok: true;
      state: DesktopLicenseState;
      capability: EntitlementCapabilityCategory;
      action: string;
    }
  | {
      ok: false;
      code: "entitlement_read_only";
      state: DesktopLicenseState;
      capability: EntitlementCapabilityCategory;
      action: string;
      denialCode?: EntitlementDenialCode;
    };

export type EntitlementGuard = {
  /** Re-evaluate lease/state; rereads the state file when mtime/size changes. */
  refresh: () => Promise<EntitlementGuardSnapshot>;
  /** Last evaluation, or null if never refreshed. */
  getSnapshot: () => EntitlementGuardSnapshot | null;
  /**
   * Ensure a fresh evaluation, then allow or throw `EntitlementReadOnlyError`.
   * Primary integration API for future host-bridge / admission wiring.
   */
  assertCapability: (
    capability: EntitlementCapabilityCategory,
    action: string,
  ) => Promise<void>;
  /** Ensure fresh evaluation; return a safe decision without throwing. */
  checkCapability: (
    capability: EntitlementCapabilityCategory,
    action: string,
  ) => Promise<EntitlementGuardCheck>;
  /**
   * Sync assert against the last snapshot. Throws if never refreshed —
   * call `refresh()` first, or prefer `assertCapability`.
   */
  assertCapabilitySync: (
    capability: EntitlementCapabilityCategory,
    action: string,
  ) => void;
};

const AUTHORITATIVE_STATES = new Set<string>([
  "none",
  "suspended",
  "refunded",
  "revoked",
  "device_deactivated",
]);

const GD3_PRODUCT_KEY_RE = /\bGD3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const PRIVATE_KEY_FIELD_RE =
  /privatePkcs8|private_key|privateKey|-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/i;

const DEFAULT_MAX_STATE_BYTES = 64 * 1024;
const DEFAULT_GROK_CAPABILITY = "grok-runtime";

type CachedFile = {
  mtimeMs: number;
  size: number;
  raw: string;
  envelope: EntitlementStateEnvelope | null;
  parseError: EntitlementDenialCode | null;
};

type VerifiedCache = {
  fileKey: string | null;
  claims: DeviceLeaseClaims | null;
  verifyCode: EntitlementDenialCode | null;
};

function isKeyObject(value: unknown): value is KeyObject {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as KeyObject).type === "string" &&
    typeof (value as KeyObject).export === "function"
  );
}

function isPublicJwk(value: unknown): value is PublicJwk {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PublicJwk).kty === "OKP" &&
    (value as PublicJwk).crv === "Ed25519" &&
    typeof (value as PublicJwk).x === "string"
  );
}

function peekJwtKid(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const headerJson = Buffer.from(parts[0]!, "base64url").toString("utf8");
    const header = JSON.parse(headerJson) as { kid?: unknown };
    return typeof header.kid === "string" && header.kid.length > 0
      ? header.kid
      : null;
  } catch {
    return null;
  }
}

function resolvePublicKey(
  keyRing: EntitlementKeyRing,
  kid: string | null,
): PublicJwk | KeyObject | null {
  if (keyRing instanceof Map) {
    if (kid && keyRing.has(kid)) {
      return keyRing.get(kid) ?? null;
    }
    // Single-entry ring: allow match without kid when only one trusted key.
    if (keyRing.size === 1) {
      const only = keyRing.values().next().value;
      return only ?? null;
    }
    return null;
  }
  if (isKeyObject(keyRing) || isPublicJwk(keyRing)) {
    return keyRing;
  }
  return null;
}

/**
 * Parse and validate a state envelope from JSON text.
 * Rejects secret-bearing content and unknown schemas.
 */
export function parseEntitlementStateEnvelope(
  raw: string,
  maxBytes: number = DEFAULT_MAX_STATE_BYTES,
): EntitlementStateEnvelope {
  if (typeof raw !== "string") {
    throw new Error("corrupt_state");
  }
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new Error("corrupt_state");
  }
  if (GD3_PRODUCT_KEY_RE.test(raw) || PRIVATE_KEY_FIELD_RE.test(raw)) {
    throw new Error("contains_secrets");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("corrupt_state");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("corrupt_state");
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.schema !== undefined && rec.schema !== 1) {
    throw new Error("corrupt_state");
  }
  if (typeof rec.deviceId !== "string" || rec.deviceId.length === 0) {
    throw new Error("corrupt_state");
  }
  if (
    typeof rec.devicePublicKeyThumbprint !== "string" ||
    rec.devicePublicKeyThumbprint.length === 0
  ) {
    throw new Error("corrupt_state");
  }
  if (!(rec.lease === null || typeof rec.lease === "string")) {
    throw new Error("corrupt_state");
  }
  if (typeof rec.lease === "string") {
    if (rec.lease.startsWith("GD3.") || GD3_PRODUCT_KEY_RE.test(rec.lease)) {
      throw new Error("contains_secrets");
    }
    if (PRIVATE_KEY_FIELD_RE.test(rec.lease)) {
      throw new Error("contains_secrets");
    }
  }
  if (
    typeof rec.authoritativeState !== "string" ||
    !AUTHORITATIVE_STATES.has(rec.authoritativeState)
  ) {
    throw new Error("corrupt_state");
  }

  return {
    schema: 1,
    deviceId: rec.deviceId,
    devicePublicKeyThumbprint: rec.devicePublicKeyThumbprint,
    lease: rec.lease as string | null,
    authoritativeState: rec.authoritativeState as AuthoritativeState,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : undefined,
    requestId:
      rec.requestId === null || typeof rec.requestId === "string"
        ? (rec.requestId as string | null)
        : null,
  };
}

function denialFromAuthoritative(
  state: AuthoritativeState,
):
  | {
      code: Extract<
        StableErrorCode,
        | "entitlement_suspended"
        | "entitlement_refunded"
        | "entitlement_revoked"
        | "device_deactivated"
      >;
    }
  | null {
  switch (state) {
    case "suspended":
      return { code: "entitlement_suspended" };
    case "refunded":
      return { code: "entitlement_refunded" };
    case "revoked":
      return { code: "entitlement_revoked" };
    case "device_deactivated":
      return { code: "device_deactivated" };
    case "none":
      return null;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function mapVerifyFailureToDenial(
  code: string,
): EntitlementDenialCode {
  switch (code) {
    case "lease_expired":
      return "lease_expired";
    case "lease_device_mismatch":
      return "lease_device_mismatch";
    case "device_deactivated":
      return "device_deactivated";
    case "unknown_key":
      return "unknown_key";
    case "invalid_key_format":
      return "invalid_key_format";
    case "invalid_key_signature":
      return "invalid_key_signature";
    default:
      return "invalid_key_signature";
  }
}

function desktopStateForDenial(
  denialCode: EntitlementDenialCode,
): DesktopLicenseState {
  switch (denialCode) {
    case "lease_expired":
      return "lease_expired";
    case "entitlement_suspended":
      return "suspended";
    case "entitlement_refunded":
      return "refunded";
    case "entitlement_revoked":
      return "revoked";
    case "device_deactivated":
      return "device_deactivated";
    case "lease_device_mismatch":
    case "key_rotated":
    case "unsupported_client":
    case "unsupported_architecture":
      return "read_only";
    case "service_unavailable":
    case "clock_skew":
    case "challenge_expired":
    case "challenge_replayed":
    case "device_signature_invalid":
    case "grant_expired":
    case "grant_used":
    case "grant_binding_mismatch":
      return "service_unavailable";
    case "seat_limit":
      return "seat_limit";
    case "unactivated":
    case "invalid_key_format":
    case "invalid_key_signature":
    case "unknown_key":
    case "corrupt_state":
    default:
      return "unactivated";
  }
}

function capabilityAlwaysAllowed(
  capability: EntitlementCapabilityCategory,
): boolean {
  return (
    capability === "local_read" ||
    capability === "local_manage" ||
    capability === "recovery"
  );
}

/**
 * Create the shared entitlement guard used at Grok admission boundaries.
 */
export function createEntitlementGuard(
  options: EntitlementGuardOptions,
): EntitlementGuard {
  const nowFn =
    options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const clockTolerance = options.clockToleranceSeconds ?? 60;
  const maxBytes = options.maxStateBytes ?? DEFAULT_MAX_STATE_BYTES;
  const requiredGrok =
    options.requiredGrokCapability ?? DEFAULT_GROK_CAPABILITY;
  const statePath =
    typeof options.statePath === "string" && options.statePath.length > 0
      ? options.statePath
      : null;

  let fileCache: CachedFile | null = null;
  let verifiedCache: VerifiedCache = {
    fileKey: null,
    claims: null,
    verifyCode: null,
  };
  let snapshot: EntitlementGuardSnapshot | null = null;

  async function readEnvelopeFromDisk(): Promise<{
    envelope: EntitlementStateEnvelope | null;
    fileKey: string | null;
    parseError: EntitlementDenialCode | null;
  }> {
    if (!statePath) {
      return { envelope: null, fileKey: null, parseError: null };
    }

    let st: fs.Stats;
    try {
      st = await fsp.stat(statePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") {
        return { envelope: null, fileKey: null, parseError: null };
      }
      return {
        envelope: null,
        fileKey: null,
        parseError: "corrupt_state",
      };
    }

    if (
      fileCache &&
      fileCache.mtimeMs === st.mtimeMs &&
      fileCache.size === st.size
    ) {
      return {
        envelope: fileCache.envelope,
        fileKey: `${st.mtimeMs}:${st.size}`,
        parseError: fileCache.parseError,
      };
    }

    let raw: string;
    try {
      if (st.size > maxBytes) {
        fileCache = {
          mtimeMs: st.mtimeMs,
          size: st.size,
          raw: "",
          envelope: null,
          parseError: "corrupt_state",
        };
        return {
          envelope: null,
          fileKey: `${st.mtimeMs}:${st.size}`,
          parseError: "corrupt_state",
        };
      }
      raw = await fsp.readFile(statePath, "utf8");
    } catch {
      return {
        envelope: null,
        fileKey: null,
        parseError: "corrupt_state",
      };
    }

    try {
      const envelope = parseEntitlementStateEnvelope(raw, maxBytes);
      fileCache = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        raw,
        envelope,
        parseError: null,
      };
      return {
        envelope,
        fileKey: `${st.mtimeMs}:${st.size}`,
        parseError: null,
      };
    } catch {
      fileCache = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        raw: "",
        envelope: null,
        parseError: "corrupt_state",
      };
      return {
        envelope: null,
        fileKey: `${st.mtimeMs}:${st.size}`,
        parseError: "corrupt_state",
      };
    }
  }

  async function loadEnvelope(): Promise<{
    envelope: EntitlementStateEnvelope | null;
    fileKey: string | null;
    parseError: EntitlementDenialCode | null;
  }> {
    if (options.loadState) {
      try {
        const state = await options.loadState();
        return {
          envelope: state,
          fileKey: state
            ? `inject:${state.updatedAt ?? ""}:${state.authoritativeState}:${state.lease === null ? "0" : "1"}:${state.lease?.length ?? 0}`
            : "inject:null",
          parseError: null,
        };
      } catch {
        return {
          envelope: null,
          fileKey: "inject:error",
          parseError: "corrupt_state",
        };
      }
    }
    return readEnvelopeFromDisk();
  }

  async function verifyLeaseToken(
    lease: string,
    expectedDeviceThumbprint: string,
    nowSeconds: number,
  ): Promise<
    | { ok: true; claims: DeviceLeaseClaims }
    | { ok: false; code: EntitlementDenialCode }
  > {
    const kid = peekJwtKid(lease);
    const publicKey = resolvePublicKey(options.keyRing, kid);
    if (!publicKey) {
      return { ok: false, code: "unknown_key" };
    }
    const result = await verifyDeviceLease(lease, {
      publicKey,
      expectedIssuer: options.expectedIssuer,
      expectedAudience: options.expectedAudience,
      expectedDeviceThumbprint,
      nowSeconds,
      clockToleranceSeconds: clockTolerance,
    });
    if (!result.ok) {
      return { ok: false, code: mapVerifyFailureToDenial(result.code) };
    }
    return { ok: true, claims: result.claims };
  }

  async function resolveClaims(
    envelope: EntitlementStateEnvelope | null,
    fileKey: string | null,
    nowSeconds: number,
  ): Promise<{
    claims: DeviceLeaseClaims | null;
    verifyCode: EntitlementDenialCode | null;
  }> {
    // Explicit inject path (including null).
    if (options.injectVerifiedClaims !== undefined) {
      return {
        claims: options.injectVerifiedClaims,
        verifyCode: options.injectVerifiedClaims ? null : "unactivated",
      };
    }

    if (!envelope?.lease) {
      return { claims: null, verifyCode: "unactivated" };
    }

    // Reuse crypto verification when file identity unchanged.
    if (
      verifiedCache.fileKey !== null &&
      verifiedCache.fileKey === fileKey &&
      verifiedCache.claims
    ) {
      // Still re-check expiry against current clock without re-verifying JWS.
      if (verifiedCache.claims.exp + clockTolerance < nowSeconds) {
        return { claims: null, verifyCode: "lease_expired" };
      }
      return {
        claims: verifiedCache.claims,
        verifyCode: null,
      };
    }
    if (
      verifiedCache.fileKey !== null &&
      verifiedCache.fileKey === fileKey &&
      verifiedCache.verifyCode
    ) {
      // Prior verify failure for this file version (signature etc.) is stable.
      if (
        verifiedCache.verifyCode === "lease_expired" ||
        verifiedCache.verifyCode === "unactivated"
      ) {
        // re-evaluate time-sensitive cases below
      } else {
        return { claims: null, verifyCode: verifiedCache.verifyCode };
      }
    }

    const verified = await verifyLeaseToken(
      envelope.lease,
      envelope.devicePublicKeyThumbprint,
      nowSeconds,
    );
    if (!verified.ok) {
      verifiedCache = {
        fileKey,
        claims: null,
        verifyCode: verified.code,
      };
      return { claims: null, verifyCode: verified.code };
    }
    verifiedCache = {
      fileKey,
      claims: verified.claims,
      verifyCode: null,
    };
    return { claims: verified.claims, verifyCode: null };
  }

  function buildSnapshot(input: {
    nowSeconds: number;
    claims: DeviceLeaseClaims | null;
    verifyCode: EntitlementDenialCode | null;
    authoritativeState: AuthoritativeState;
    parseError: EntitlementDenialCode | null;
  }): EntitlementGuardSnapshot {
    if (input.parseError) {
      return {
        state: desktopStateForDenial(input.parseError),
        grokAllowed: false,
        hasVerifiedLease: false,
        evaluatedAtSeconds: input.nowSeconds,
        denialCode: input.parseError,
      };
    }

    const authDenial = denialFromAuthoritative(input.authoritativeState);
    if (authDenial) {
      const decision = deriveEntitlementState({
        claims: input.claims,
        denial: authDenial,
        nowSeconds: input.nowSeconds,
      });
      return {
        state: decision.state,
        grokAllowed: false,
        hasVerifiedLease: Boolean(input.claims),
        evaluatedAtSeconds: input.nowSeconds,
        denialCode: authDenial.code,
      };
    }

    if (!input.claims) {
      const denialCode = input.verifyCode ?? "unactivated";
      return {
        state: desktopStateForDenial(denialCode),
        grokAllowed: false,
        hasVerifiedLease: false,
        evaluatedAtSeconds: input.nowSeconds,
        denialCode,
      };
    }

    // Require the Grok runtime capability on the lease.
    if (!input.claims.capabilities.includes(requiredGrok)) {
      return {
        state: "read_only",
        grokAllowed: false,
        hasVerifiedLease: true,
        evaluatedAtSeconds: input.nowSeconds,
        denialCode: "unsupported_client",
      };
    }

    const decision = deriveEntitlementState({
      claims: input.claims,
      nowSeconds: input.nowSeconds,
    });

    if (!decision.ok) {
      return {
        state: decision.state,
        grokAllowed: false,
        hasVerifiedLease: true,
        evaluatedAtSeconds: input.nowSeconds,
        denialCode: decision.code as EntitlementDenialCode,
      };
    }

    const grokAllowed = (
      GROK_OPERATION_ALLOWED_STATES as readonly string[]
    ).includes(decision.state);

    return {
      state: decision.state,
      grokAllowed,
      hasVerifiedLease: true,
      evaluatedAtSeconds: input.nowSeconds,
      ...(grokAllowed ? {} : { denialCode: "lease_expired" as const }),
    };
  }

  async function refresh(): Promise<EntitlementGuardSnapshot> {
    const nowSeconds = nowFn();
    const { envelope, fileKey, parseError } = await loadEnvelope();
    const { claims, verifyCode } = await resolveClaims(
      envelope,
      fileKey,
      nowSeconds,
    );
    snapshot = buildSnapshot({
      nowSeconds,
      claims,
      verifyCode,
      authoritativeState: envelope?.authoritativeState ?? "none",
      parseError,
    });
    return snapshot;
  }

  function decide(
    snap: EntitlementGuardSnapshot,
    capability: EntitlementCapabilityCategory,
    action: string,
  ): EntitlementGuardCheck {
    if (capabilityAlwaysAllowed(capability)) {
      return {
        ok: true,
        state: snap.state,
        capability,
        action,
      };
    }
    if (capability === "grok_operation" && snap.grokAllowed) {
      return {
        ok: true,
        state: snap.state,
        capability,
        action,
      };
    }
    return {
      ok: false,
      code: "entitlement_read_only",
      state: snap.state,
      capability,
      action,
      ...(snap.denialCode !== undefined
        ? { denialCode: snap.denialCode }
        : {}),
    };
  }

  function throwIfDenied(check: EntitlementGuardCheck): void {
    if (check.ok) return;
    throw new EntitlementReadOnlyError({
      state: check.state,
      action: check.action,
      capability: check.capability,
      denialCode: check.denialCode,
    });
  }

  return {
    refresh,
    getSnapshot: () => snapshot,
    async assertCapability(capability, action) {
      const snap = await refresh();
      throwIfDenied(decide(snap, capability, action));
    },
    async checkCapability(capability, action) {
      const snap = await refresh();
      return decide(snap, capability, action);
    },
    assertCapabilitySync(capability, action) {
      if (!snapshot) {
        throw new EntitlementReadOnlyError({
          state: "unactivated",
          action,
          capability,
          denialCode: "unactivated",
        });
      }
      throwIfDenied(decide(snapshot, capability, action));
    },
  };
}

export type { DeviceLeaseClaims };
