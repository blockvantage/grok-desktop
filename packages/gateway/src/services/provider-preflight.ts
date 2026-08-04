/**
 * Neutral provider capability preflight before engine start (Phase 3 bridge).
 * Uses ProviderRegistry at composition root — TaskRunner never imports Grok types.
 *
 * Decision table matches evaluateProviderOwnToolsGate so registry-backed preflight
 * and engine executesOwnTools semantics stay aligned.
 */
import type { ProviderRegistry } from "@grokdesk/agent-runtime";
import type { Task } from "@grokdesk/shared";
import { evaluateProviderOwnToolsGate } from "./policy-provider-gate.js";

export type ProviderPreflightResult =
  | { action: "proceed" }
  | { action: "reject"; reason: string }
  | { action: "degraded"; reason: string };

export type ProviderPreflightFn = (
  task: Task,
) => Promise<ProviderPreflightResult>;

/**
 * Build a preflight that consults the registered provider's declared capabilities.
 * Uncontrolled / non-enforceable mediation → same reject/degrade rules as engine path.
 * ACP (policyEnforceable + provider-permission-rpc) → proceed (enforcement at permission RPC).
 */
export function createProviderPreflight(
  providers: ProviderRegistry,
  opts?: { defaultProviderId?: string },
): ProviderPreflightFn {
  const defaultId = opts?.defaultProviderId ?? "grok";

  return async (task: Task): Promise<ProviderPreflightResult> => {
    const provider = providers.get(defaultId);
    if (!provider) {
      return {
        action: "reject",
        reason: `No provider registered for id=${defaultId}`,
      };
    }

    const caps = await provider.getCapabilities(task.model);
    const executesOwnTools =
      caps.toolMediation === "uncontrolled" || !caps.policyEnforceable;

    const gate = evaluateProviderOwnToolsGate({
      executesOwnTools,
      allowShell: task.policySnapshot.allowShell,
      allowNetworkTools: task.policySnapshot.allowNetworkTools,
      approvalMode: task.policySnapshot.approvalMode,
    });

    if (gate.action === "reject") {
      return { action: "reject", reason: gate.message };
    }
    if (gate.action === "degraded") {
      return { action: "degraded", reason: gate.stepTitle };
    }
    return { action: "proceed" };
  };
}
