/**
 * Pure policy gate for providers that execute their own tools (SEC-01 / GROK-02).
 * Extracted from TaskRunner so unit tests drive the decision table without I/O.
 */

export type ProviderGateAction =
  | {
      action: "reject";
      message: string;
      receipt: {
        action: "policy.provider_gate";
        decision: "deny";
        effect: "rejected";
        detail: Record<string, unknown>;
      };
    }
  | {
      action: "degraded";
      stepTitle: string;
      receipt: {
        action: "policy.provider_gate";
        decision: "info";
        effect: "degraded";
        detail: Record<string, unknown>;
      };
    }
  | { action: "proceed" };

export interface ProviderGateInput {
  /** True when the engine/provider runs tools outside gateway mediation. */
  executesOwnTools: boolean;
  allowShell: boolean;
  allowNetworkTools: boolean;
  approvalMode: "strict" | "balanced" | "autopilot";
}

/**
 * Evaluate whether an uncontrolled provider may start a run under Desk policy.
 *
 * - Denied shell/network → fail closed (reject).
 * - Strict with shell/network still allowed → visibly degraded (not silent).
 * - Controllable mediation (executesOwnTools false) → proceed.
 */
export function evaluateProviderOwnToolsGate(
  input: ProviderGateInput,
): ProviderGateAction {
  if (!input.executesOwnTools) {
    return { action: "proceed" };
  }

  const deniedCaps = !input.allowShell || !input.allowNetworkTools;
  if (deniedCaps) {
    return {
      action: "reject",
      message:
        "Policy fail-closed: headless Grok executes its own tools and cannot guarantee denied shell/network. Use gateway-mediated tools or ACP when available, or allow shell/network.",
      receipt: {
        action: "policy.provider_gate",
        decision: "deny",
        effect: "rejected",
        detail: {
          reason: "uncontrolled_cannot_enforce_deny",
          allowShell: input.allowShell,
          allowNetworkTools: input.allowNetworkTools,
        },
      },
    };
  }

  if (input.approvalMode === "strict") {
    return {
      action: "degraded",
      stepTitle:
        "Degraded policy mode: provider executes tools outside gateway mediation; plan mode ≠ ask-before-effect. Denied operations are not guaranteed.",
      receipt: {
        action: "policy.provider_gate",
        decision: "info",
        effect: "degraded",
        detail: {
          reason: "uncontrolled_tool_mediation",
          approvalMode: input.approvalMode,
        },
      },
    };
  }

  return { action: "proceed" };
}
