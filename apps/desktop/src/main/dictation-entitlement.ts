/**
 * Pure dictation admission helpers (no Electron / engine imports).
 * Used by dictation-service at capture-start and STT-upload boundaries.
 *
 * Free Desk: product-license state never blocks dictation. Optional runtime
 * security/admission pauses may still block when a readiness gate is wired.
 */

/**
 * Injectable admission gate for dictation.
 * Return allowed:false with a safe code/state only — never product keys.
 */
export type DictationEntitlementGate = {
  assertDictationAllowed: (boundary: DictationBoundary) => Promise<
    | { ok: true }
    | { ok: false; error: "entitlement_read_only"; state?: string }
  >;
};

export type DictationBoundary = "capture_start" | "stt_upload";

/**
 * Pure admission helper (unit-testable without Electron IPC).
 * Free Desk: missing gate admits (no product-license fail-closed).
 */
export async function ensureDictationEntitlement(
  gate: DictationEntitlementGate | null | undefined,
  boundary: DictationBoundary,
): Promise<
  | { ok: true }
  | { ok: false; error: "entitlement_read_only"; state?: string }
> {
  if (!gate) {
    return { ok: true };
  }
  return gate.assertDictationAllowed(boundary);
}

/**
 * Runtime reasons that should block dictation (hard admission / security).
 * Managed-runtime missing is NOT a block: STT uses SuperGrok token + API,
 * not the managed Grok CLI binary.
 */
const DICTATION_BLOCKING_RUNTIME = new Set([
  "security_block",
  "admission_paused",
]);

/**
 * Free Desk production gate: ignore product-license status; only hard-block
 * security/admission pauses from runtime readiness when provided.
 */
export function dictationGateFromStatus(
  _getStatus: () => Promise<{ state: string }>,
  getRuntimeReadiness?: () => { ready: boolean; reason?: string },
): DictationEntitlementGate {
  return {
    assertDictationAllowed: async () => {
      try {
        if (getRuntimeReadiness) {
          const readiness = getRuntimeReadiness();
          if (
            !readiness.ready &&
            readiness.reason &&
            DICTATION_BLOCKING_RUNTIME.has(readiness.reason)
          ) {
            return {
              ok: false,
              error: "entitlement_read_only",
              state: readiness.reason,
            };
          }
        }
        return { ok: true };
      } catch {
        // Free Desk: do not fail closed on status probe errors.
        return { ok: true };
      }
    },
  };
}

/**
 * Build a gate from any object that exposes assertCapability (runtime readiness).
 * Keeps desktop free of hard-wiring a gateway singleton at module load.
 */
export function dictationGateFromAssert(
  assertCapability: (
    capability: "grok_operation",
    action: string,
  ) => Promise<void>,
): DictationEntitlementGate {
  return {
    assertDictationAllowed: async () => {
      try {
        await assertCapability("grok_operation", "dictation");
        return { ok: true };
      } catch (e) {
        const err = e as {
          code?: string;
          state?: string;
          name?: string;
        };
        if (
          err?.code === "entitlement_read_only" ||
          err?.name === "EntitlementReadOnlyError"
        ) {
          return {
            ok: false,
            error: "entitlement_read_only",
            ...(typeof err.state === "string" ? { state: err.state } : {}),
          };
        }
        throw e;
      }
    },
  };
}
