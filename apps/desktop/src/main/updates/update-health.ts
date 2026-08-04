/**
 * Post-restart health checks for a synchronized Desk/Grok update.
 *
 * Commit only after Desk version, managed Grok version/digest/capabilities,
 * gateway readiness, auth-status responsiveness, and main health all pass.
 * Runtime failure restores the previous compatible runtime when possible.
 */
import type { CanonicalRuntimeTarget } from "@grokdesk/shared";
import type { PreviousRuntimeRef, TargetPairRef } from "./update-journal.js";

export type HealthProbeResult =
  | { ok: true; detail?: string }
  | { ok: false; code: string; message: string };

export type UpdateHealthSnapshot = {
  deskVersion: string;
  grokVersion: string;
  grokDigestSha256: string;
  grokCapabilities: readonly string[];
  target: CanonicalRuntimeTarget;
  gatewayReady: boolean;
  authStatusOk: boolean;
  mainHealthy: boolean;
};

export type UpdateHealthDeps = {
  /** Actual Desk (Electron app) version after restart. */
  getDeskVersion: () => string | Promise<string>;
  /** Managed runtime binary version currently selected. */
  getGrokVersion: () => string | Promise<string>;
  /** Digest of the currently selected managed binary. */
  getGrokDigest: () => string | Promise<string>;
  /** Declared/probed capabilities of the current runtime. */
  getGrokCapabilities: () => readonly string[] | Promise<readonly string[]>;
  getTarget: () => CanonicalRuntimeTarget | Promise<CanonicalRuntimeTarget>;
  /** Gateway process accepting RPCs. */
  probeGateway: () => HealthProbeResult | Promise<HealthProbeResult>;
  /** SuperGrok auth-status endpoint / IPC is responsive (not necessarily logged in). */
  probeAuthStatus: () => HealthProbeResult | Promise<HealthProbeResult>;
  /** Main-process liveness (always true in-process; injectable for tests). */
  probeMain?: () => HealthProbeResult | Promise<HealthProbeResult>;
};

export type PostUpdateHealthInput = {
  expected: TargetPairRef;
  /** Required capability strings from the resolved pair (if any). */
  requiredCapabilities?: readonly string[];
  /** Expected digest for the target Grok when known. */
  expectedGrokDigest?: string;
  previousRuntime?: PreviousRuntimeRef | null;
};

export type PostUpdateHealthResult =
  | {
      ok: true;
      snapshot: UpdateHealthSnapshot;
      notes: string[];
    }
  | {
      ok: false;
      code:
        | "desk_version_mismatch"
        | "grok_version_mismatch"
        | "grok_digest_mismatch"
        | "capability_missing"
        | "gateway_unready"
        | "auth_unready"
        | "main_unhealthy"
        | "target_mismatch";
      message: string;
      snapshot: Partial<UpdateHealthSnapshot>;
      notes: string[];
      /** When true, coordinator should restore previousRuntime. */
      restorePrevious: boolean;
    };

function lowerHex(v: string): string {
  return v.toLowerCase();
}

/**
 * Verify the running Desk/Grok pair matches the journaled target after restart.
 */
export async function verifyPostUpdateHealth(
  deps: UpdateHealthDeps,
  input: PostUpdateHealthInput,
): Promise<PostUpdateHealthResult> {
  const notes: string[] = [];
  const deskVersion = await deps.getDeskVersion();
  const grokVersion = await deps.getGrokVersion();
  const grokDigestSha256 = lowerHex(await deps.getGrokDigest());
  const grokCapabilities = [...(await deps.getGrokCapabilities())];
  const target = await deps.getTarget();

  const snapshot: UpdateHealthSnapshot = {
    deskVersion,
    grokVersion,
    grokDigestSha256,
    grokCapabilities,
    target,
    gatewayReady: false,
    authStatusOk: false,
    mainHealthy: false,
  };

  if (deskVersion !== input.expected.deskVersion) {
    notes.push("desk_version_mismatch");
    return {
      ok: false,
      code: "desk_version_mismatch",
      message: `expected desk ${input.expected.deskVersion}, got ${deskVersion}`,
      snapshot,
      notes,
      // Desk binary cannot be rolled back in-process; enter repair.
      restorePrevious: false,
    };
  }
  notes.push("desk_ok");

  if (grokVersion !== input.expected.grokVersion) {
    notes.push("grok_version_mismatch");
    return {
      ok: false,
      code: "grok_version_mismatch",
      message: `expected grok ${input.expected.grokVersion}, got ${grokVersion}`,
      snapshot,
      notes,
      restorePrevious: Boolean(input.previousRuntime),
    };
  }
  notes.push("grok_version_ok");

  if (input.expectedGrokDigest) {
    if (lowerHex(input.expectedGrokDigest) !== grokDigestSha256) {
      notes.push("grok_digest_mismatch");
      return {
        ok: false,
        code: "grok_digest_mismatch",
        message: "managed grok digest does not match staged pair",
        snapshot,
        notes,
        restorePrevious: Boolean(input.previousRuntime),
      };
    }
    notes.push("grok_digest_ok");
  }

  if (input.requiredCapabilities && input.requiredCapabilities.length > 0) {
    const have = new Set(grokCapabilities);
    for (const cap of input.requiredCapabilities) {
      if (!have.has(cap)) {
        notes.push(`capability_missing:${cap}`);
        return {
          ok: false,
          code: "capability_missing",
          message: `missing capability ${cap}`,
          snapshot,
          notes,
          restorePrevious: Boolean(input.previousRuntime),
        };
      }
    }
    notes.push("capabilities_ok");
  }

  const main = await (deps.probeMain?.() ?? { ok: true as const, detail: "in_process" });
  if (!main.ok) {
    notes.push(`main:${main.code}`);
    return {
      ok: false,
      code: "main_unhealthy",
      message: main.message,
      snapshot,
      notes,
      restorePrevious: false,
    };
  }
  snapshot.mainHealthy = true;
  notes.push("main_ok");

  const gateway = await deps.probeGateway();
  if (!gateway.ok) {
    notes.push(`gateway:${gateway.code}`);
    return {
      ok: false,
      code: "gateway_unready",
      message: gateway.message,
      snapshot,
      notes,
      restorePrevious: Boolean(input.previousRuntime),
    };
  }
  snapshot.gatewayReady = true;
  notes.push("gateway_ok");

  const auth = await deps.probeAuthStatus();
  if (!auth.ok) {
    notes.push(`auth:${auth.code}`);
    return {
      ok: false,
      code: "auth_unready",
      message: auth.message,
      snapshot,
      notes,
      // Auth probe failure is not a runtime digression — do not swap Grok.
      restorePrevious: false,
    };
  }
  snapshot.authStatusOk = true;
  notes.push("auth_ok");

  return { ok: true, snapshot, notes };
}
