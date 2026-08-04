/**
 * Pure preflight outcome → transcript/receipt/status actions (Phase 6 extract).
 * I/O (appendEvent, receipts, status) stays in TaskRunner.
 */

export type PreflightGateResult =
  | { action: "reject"; reason: string }
  | { action: "degraded"; reason: string }
  | { action: "allow" };

export type PreflightApplyPlan =
  | {
      kind: "reject";
      errorMessage: string;
      terminalStatus: "failed";
      attemptReason: "policy_fail_closed";
      receiptSource: "provider_preflight_reject" | "engine_gate_reject";
    }
  | {
      kind: "degraded";
      stepTitle: string;
      receiptSource: "provider_preflight_degraded" | "engine_gate_degraded";
    }
  | { kind: "continue" };

/**
 * Map registry-backed preflight result to a run plan.
 */
export function planFromProviderPreflight(
  pre: { action: string; reason?: string },
): PreflightApplyPlan {
  if (pre.action === "reject") {
    return {
      kind: "reject",
      errorMessage: String(pre.reason ?? "Provider preflight rejected"),
      terminalStatus: "failed",
      attemptReason: "policy_fail_closed",
      receiptSource: "provider_preflight_reject",
    };
  }
  if (pre.action === "degraded") {
    return {
      kind: "degraded",
      stepTitle: String(pre.reason ?? "Provider running in degraded mode"),
      receiptSource: "provider_preflight_degraded",
    };
  }
  return { kind: "continue" };
}

/**
 * Map evaluateProviderOwnToolsGate-style result to a run plan.
 */
export function planFromEngineOwnToolsGate(gate: {
  action: string;
  message?: string;
  stepTitle?: string;
}): PreflightApplyPlan {
  if (gate.action === "reject") {
    return {
      kind: "reject",
      errorMessage: String(gate.message ?? "Policy gate rejected run"),
      terminalStatus: "failed",
      attemptReason: "policy_fail_closed",
      receiptSource: "engine_gate_reject",
    };
  }
  if (gate.action === "degraded") {
    return {
      kind: "degraded",
      stepTitle: String(gate.stepTitle ?? gate.message ?? "Degraded policy mode"),
      receiptSource: "engine_gate_degraded",
    };
  }
  return { kind: "continue" };
}
