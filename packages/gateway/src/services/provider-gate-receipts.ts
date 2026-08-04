/**
 * Operation receipt + stream side-effects for provider policy preflight
 * (registry path). Mirrors evaluateProviderOwnToolsGate receipt shapes.
 */

export type ProviderPreflightReject = {
  action: "reject";
  reason: string;
};

export type ProviderPreflightDegraded = {
  action: "degraded";
  reason: string;
};

export function providerPreflightRejectReceipt(reason: string): {
  action: "policy.provider_gate";
  decision: "deny";
  effect: "rejected";
  detail: Record<string, unknown>;
} {
  return {
    action: "policy.provider_gate",
    decision: "deny",
    effect: "rejected",
    detail: {
      reason: "provider_preflight_reject",
      message: reason,
      source: "provider_registry",
    },
  };
}

export function providerPreflightDegradedReceipt(reason: string): {
  action: "policy.provider_gate";
  decision: "info";
  effect: "degraded";
  detail: Record<string, unknown>;
} {
  return {
    action: "policy.provider_gate",
    decision: "info",
    effect: "degraded",
    detail: {
      reason: "provider_preflight_degraded",
      message: reason,
      source: "provider_registry",
    },
  };
}

/**
 * Terminal status + run-attempt reason after engine.run returns while still "running".
 */
export function terminalAfterEngineRun(sawError: boolean): {
  status: "failed" | "done";
  reason: "engine_error" | "completed";
} {
  return sawError
    ? { status: "failed", reason: "engine_error" }
    : { status: "done", reason: "completed" };
}

/**
 * Message when engine process ends while parked on approval/user input.
 */
export const ENGINE_ENDED_WAITING_MESSAGE =
  "Session ended while waiting for approval. Re-run the task or approve sooner.";

export function isParkedWaitingStatus(status: string): boolean {
  return status === "waiting_approval" || status === "waiting_user";
}
