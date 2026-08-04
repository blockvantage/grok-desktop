/**
 * Gateway admission composition for free Desk.
 *
 * Product-device-lease / product-key enforcement is retired. This module still
 * wires **managed-runtime / update readiness** so Grok work does not start
 * without a usable runtime when Desktop main publishes readiness state.
 *
 * Never installs a product-license deny-all guard when lease env is absent.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { PublicJwk } from "@grokdesk/license";
import type { EngineAdapter } from "../engine-types.js";
import {
  createEntitlementGuard,
  type EntitlementGuard,
  type EntitlementGuardCheck,
  type EntitlementGuardSnapshot,
  type EntitlementKeyRing,
} from "./entitlement-guard.js";
import { wrapEngineWithEntitlementGuard } from "./entitlement-engine.js";
import {
  EntitlementReadOnlyError,
  type EntitlementDenialCode,
} from "./entitlement-error.js";

/** Absolute path of the atomic entitlement state file (main → gateway). */
export const ENTITLEMENT_STATE_PATH_ENV =
  "GROKDESK_ENTITLEMENT_STATE_PATH" as const;
/** JSON array (or JWKS `{ keys: [...] }`) of OKP Ed25519 public lease JWKs. */
export const LEASE_PUBLIC_JWKS_ENV = "GROKDESK_LEASE_PUBLIC_JWKS" as const;
/** Lease `iss` claim expected by the gateway guard. */
export const ENTITLEMENT_ISSUER_ENV = "GROKDESK_ENTITLEMENT_ISSUER" as const;
/** Lease `aud` claim expected by the gateway guard. */
export const ENTITLEMENT_AUDIENCE_ENV =
  "GROKDESK_ENTITLEMENT_AUDIENCE" as const;
/**
 * When `"1"` / `"true"`, incomplete env still installs a fail-closed
 * (deny grok_operation) guard. When `"0"` / `"false"`, incomplete env → null.
 */
export const ENTITLEMENT_FAIL_CLOSED_ENV =
  "GROKDESK_ENTITLEMENT_FAIL_CLOSED" as const;
/** Atomic main-owned runtime/update readiness state consumed at every admission. */
export const RUNTIME_READINESS_STATE_PATH_ENV =
  "GROKDESK_RUNTIME_READINESS_STATE_PATH" as const;
/** Require a valid healthy readiness state even when no state path is present. */
export const RUNTIME_READINESS_FAIL_CLOSED_ENV =
  "GROKDESK_RUNTIME_READINESS_FAIL_CLOSED" as const;

const DEFAULT_ISSUER = "https://api.x.ai";
const DEFAULT_AUDIENCE = "grok-desk";
const MAX_RUNTIME_READINESS_BYTES = 16 * 1024;

export type EnvLike = Record<string, string | undefined>;

export type RuntimeReadinessState = {
  schemaVersion: 1;
  managedRuntimeReady: boolean;
  updatesReady: boolean;
  admissionPaused: boolean;
  securityBlocked: boolean;
  reason: string;
  updatedAt: string;
};

type RuntimeReadinessDecision =
  | { ok: true; state: RuntimeReadinessState }
  | {
      ok: false;
      denialCode: EntitlementDenialCode;
      state: RuntimeReadinessState | null;
    };

function runtimeReadinessFailClosed(env: EnvLike): boolean {
  const raw = env[RUNTIME_READINESS_FAIL_CLOSED_ENV]?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return env.GROKDESK_PACKAGED === "1";
}

function parseRuntimeReadinessState(raw: unknown): RuntimeReadinessState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    o.schemaVersion !== 1 ||
    typeof o.managedRuntimeReady !== "boolean" ||
    typeof o.updatesReady !== "boolean" ||
    typeof o.admissionPaused !== "boolean" ||
    typeof o.securityBlocked !== "boolean" ||
    typeof o.reason !== "string" ||
    o.reason.length === 0 ||
    typeof o.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(o.updatedAt))
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    managedRuntimeReady: o.managedRuntimeReady,
    updatesReady: o.updatesReady,
    admissionPaused: o.admissionPaused,
    securityBlocked: o.securityBlocked,
    reason: o.reason,
    updatedAt: o.updatedAt,
  };
}

function evaluateRuntimeReadiness(env: EnvLike): RuntimeReadinessDecision {
  const statePath = env[RUNTIME_READINESS_STATE_PATH_ENV]?.trim();
  if (!statePath || !path.isAbsolute(statePath)) {
    return { ok: false, denialCode: "readiness_state_invalid", state: null };
  }
  let raw: string;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch {
    return { ok: false, denialCode: "readiness_state_invalid", state: null };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_RUNTIME_READINESS_BYTES) {
    return { ok: false, denialCode: "readiness_state_invalid", state: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, denialCode: "readiness_state_invalid", state: null };
  }
  const state = parseRuntimeReadinessState(parsed);
  if (!state) {
    return { ok: false, denialCode: "readiness_state_invalid", state: null };
  }
  if (!state.managedRuntimeReady) {
    return { ok: false, denialCode: "managed_runtime_unavailable", state };
  }
  if (!state.updatesReady) {
    return { ok: false, denialCode: "update_readiness_unavailable", state };
  }
  if (state.securityBlocked) {
    return { ok: false, denialCode: "security_block", state };
  }
  if (state.admissionPaused) {
    return { ok: false, denialCode: "admission_paused", state };
  }
  return { ok: true, state };
}

const NEUTRAL_SNAPSHOT: EntitlementGuardSnapshot = {
  state: "active",
  grokAllowed: true,
  hasVerifiedLease: false,
  evaluatedAtSeconds: 0,
};

/** Compose main-owned runtime/update readiness with the lease guard. */
export function createRuntimeReadinessGuard(
  entitlement: EntitlementGuard | null,
  env: EnvLike,
): EntitlementGuard | null {
  const statePath = env[RUNTIME_READINESS_STATE_PATH_ENV]?.trim();
  if (!statePath && !runtimeReadinessFailClosed(env)) return entitlement;

  function deny(action: string, denialCode: EntitlementDenialCode): never {
    throw new EntitlementReadOnlyError({
      state: "service_unavailable",
      action,
      capability: "grok_operation",
      denialCode,
    });
  }

  function checkReadiness(action: string): EntitlementGuardCheck | null {
    const decision = evaluateRuntimeReadiness(env);
    if (decision.ok) return null;
    return {
      ok: false,
      code: "entitlement_read_only",
      state: "service_unavailable",
      capability: "grok_operation",
      action,
      denialCode: decision.denialCode,
    };
  }

  return {
    refresh: () => entitlement?.refresh() ?? Promise.resolve(NEUTRAL_SNAPSHOT),
    getSnapshot: () => entitlement?.getSnapshot() ?? NEUTRAL_SNAPSHOT,
    async assertCapability(capability, action) {
      if (capability === "grok_operation") {
        const blocked = checkReadiness(action);
        if (blocked && !blocked.ok) deny(action, blocked.denialCode!);
      }
      await entitlement?.assertCapability(capability, action);
    },
    async checkCapability(capability, action) {
      if (capability === "grok_operation") {
        const blocked = checkReadiness(action);
        if (blocked) return blocked;
      }
      if (entitlement) return entitlement.checkCapability(capability, action);
      return { ok: true, state: "active", capability, action };
    },
    assertCapabilitySync(capability, action) {
      if (capability === "grok_operation") {
        const blocked = checkReadiness(action);
        if (blocked && !blocked.ok) deny(action, blocked.denialCode!);
      }
      entitlement?.assertCapabilitySync(capability, action);
    },
  };
}

export type EntitlementGuardable = {
  setEntitlementGuard(guard: EntitlementGuard | null): void;
};

export type WireEntitlementEnforcementDeps = {
  taskSubmission: EntitlementGuardable;
  scheduler: EntitlementGuardable;
  runner: EntitlementGuardable;
  /** RemoteApplicationService or RemoteSessionHost when available. */
  remote?: EntitlementGuardable | null;
  getEngine: () => EngineAdapter;
  setEngine: (engine: EngineAdapter) => void;
  env?: EnvLike;
};

function isOkpEd25519PublicJwk(value: unknown): value is PublicJwk {
  if (typeof value !== "object" || value === null) return false;
  const j = value as Record<string, unknown>;
  return (
    j.kty === "OKP" &&
    j.crv === "Ed25519" &&
    typeof j.x === "string" &&
    j.x.length > 0 &&
    typeof j.kid === "string" &&
    j.kid.length > 0
  );
}

/**
 * Parse GROKDESK_LEASE_PUBLIC_JWKS into a kid → JWK map.
 * Accepts a bare JSON array or `{ keys: [...] }`. Returns null if invalid.
 */
export function parseLeasePublicJwks(
  raw: string,
): Map<string, PublicJwk> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { keys?: unknown }).keys)
  ) {
    list = (parsed as { keys: unknown[] }).keys;
  } else {
    return null;
  }

  if (list.length === 0) return null;

  const map = new Map<string, PublicJwk>();
  for (const item of list) {
    if (!isOkpEd25519PublicJwk(item)) return null;
    map.set(item.kid!, {
      kty: "OKP",
      crv: "Ed25519",
      x: item.x,
      kid: item.kid,
      ...(typeof item.alg === "string" ? { alg: item.alg } : {}),
      ...(typeof item.use === "string" ? { use: item.use } : {}),
    });
  }
  return map.size > 0 ? map : null;
}

/** Product-license fail-closed is retired; always false for free Desk. */
function failClosedEnabled(_env: EnvLike): boolean {
  return false;
}

/**
 * Deny-all Grok admission guard used when verification material is missing.
 * Local read/export/manage/recovery remain allowed (read-only product mode).
 */
export function createFailClosedEntitlementGuard(
  options: {
    expectedIssuer?: string;
    expectedAudience?: string;
  } = {},
): EntitlementGuard {
  return createEntitlementGuard({
    // Empty key ring + no state → unactivated / no verified lease.
    keyRing: new Map(),
    expectedIssuer: options.expectedIssuer ?? DEFAULT_ISSUER,
    expectedAudience: options.expectedAudience ?? DEFAULT_AUDIENCE,
    loadState: () => null,
    injectVerifiedClaims: null,
  });
}

/**
 * Product-device-lease guard from env — always null on free Desk.
 * Stale lease state files are ignored; runtime readiness is separate.
 */
export function createEntitlementGuardFromEnv(
  _env: EnvLike = process.env as EnvLike,
): EntitlementGuard | null {
  return null;
}

/**
 * Wire managed-runtime readiness into admission + last-inference boundaries.
 * Never installs a product-license deny-all guard (free Desk).
 *
 * When a readiness guard is installed, warms it once via `refresh()` so the
 * first synchronous admit sees a snapshot.
 */
export async function wireEntitlementEnforcement(
  deps: WireEntitlementEnforcementDeps,
): Promise<EntitlementGuard | null> {
  const env = deps.env ?? (process.env as EnvLike);
  // Free Desk: ignore product lease env; only compose runtime readiness.
  const guard = createRuntimeReadinessGuard(null, env);

  deps.taskSubmission.setEntitlementGuard(guard);
  deps.scheduler.setEntitlementGuard(guard);
  deps.runner.setEntitlementGuard(guard);
  deps.remote?.setEntitlementGuard(guard);

  if (guard) {
    deps.setEngine(wrapEngineWithEntitlementGuard(deps.getEngine(), guard));
    await guard.refresh();
  }

  return guard;
}
