/**
 * Explicit dual-path engine selection.
 *
 * Product default is agent-provider + ACP when the CLI probe reports agent
 * stdio support. Rollback / force headless: GROKDESK_FORCE_HEADLESS=1.
 * When ACP is unavailable and nothing opted in, stay on engine-grok headless.
 */

export type EngineSelectionMode = "engine-grok" | "agent-provider";

export type EngineSelection = {
  mode: EngineSelectionMode;
  /** Used when mode is agent-provider (default "grok"). */
  providerId: string;
  /** Whether composition should prefer ACP mediation. */
  preferAcp: boolean;
  /** Human-readable selection reasons for diagnostics/logs. */
  reasons: string[];
};

export type EnvLike = Record<string, string | undefined>;

function envTruthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Resolve which engine composition path Gateway.start should take.
 * Settings preferProviderEngine is opt-in only (default false).
 * Probe-backed acpAvailable flips the product default to agent-provider.
 */
export function resolveEngineSelection(input: {
  env?: EnvLike;
  /** Explicit product setting — never default true without user action. */
  preferProviderEngine?: boolean;
  /** True when createLiveAcpTransportFactory returned a factory. */
  acpAvailable?: boolean;
}): EngineSelection {
  const env = input.env ?? {};
  const reasons: string[] = [];

  if (envTruthy(env.GROKDESK_FORCE_HEADLESS)) {
    reasons.push("GROKDESK_FORCE_HEADLESS=1");
    return {
      mode: "engine-grok",
      providerId: "grok",
      preferAcp: false,
      reasons,
    };
  }

  const preferAcp = envTruthy(env.GROKDESK_ACP) || input.acpAvailable === true;
  if (envTruthy(env.GROKDESK_ACP)) reasons.push("GROKDESK_ACP=1");
  if (input.acpAvailable) reasons.push("acpAvailable");

  const envProvider = envTruthy(env.GROKDESK_PROVIDER_ENGINE);
  const settingsPrefer = input.preferProviderEngine === true;
  if (envProvider) reasons.push("GROKDESK_PROVIDER_ENGINE=1");
  if (settingsPrefer) reasons.push("settings.preferProviderEngine");

  if (!envProvider && !settingsPrefer) {
    if (input.acpAvailable) {
      reasons.push("default:agent-provider(acp-available)");
      return {
        mode: "agent-provider",
        providerId: "grok",
        preferAcp: true,
        reasons,
      };
    }
    reasons.push("default:engine-grok");
    return {
      mode: "engine-grok",
      providerId: "grok",
      preferAcp,
      reasons,
    };
  }

  const providerId =
    (env.GROKDESK_PROVIDER_ID ?? "").trim() || "grok";
  reasons.push(`providerId=${providerId}`);
  return {
    mode: "agent-provider",
    providerId,
    preferAcp,
    reasons,
  };
}

export type CutoverCapabilities = {
  policyEnforceable: boolean;
  toolMediation: string;
};

/**
 * Whether AgentProvider path is ready to become the *product default*
 * (still requires separate opt-in flip — this only checks capability readiness).
 */
export function evaluateDefaultCutoverReadiness(
  caps: CutoverCapabilities,
): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!caps.policyEnforceable) {
    blockers.push("policyEnforceable=false");
  }
  if (caps.toolMediation === "uncontrolled") {
    blockers.push("toolMediation=uncontrolled");
  }
  // Align with agent-runtime ToolMediation: "gateway" | "provider-permission-rpc" | "uncontrolled"
  const mediated =
    caps.toolMediation === "gateway" ||
    caps.toolMediation === "gateway-mediated" || // legacy alias
    caps.toolMediation === "provider-permission-rpc";
  if (!mediated) {
    blockers.push(`toolMediation=${caps.toolMediation}`);
  }
  return { ready: blockers.length === 0, blockers };
}

export function canClaimProductDefaultAgentProvider(
  selection: EngineSelection,
  caps: CutoverCapabilities,
): { claimable: boolean; reasons: string[] } {
  const reasons: string[] = [...selection.reasons];
  if (selection.mode !== "agent-provider") {
    reasons.push("mode≠agent-provider");
    return { claimable: false, reasons };
  }
  const readiness = evaluateDefaultCutoverReadiness(caps);
  if (!readiness.ready) {
    reasons.push(...readiness.blockers.map((b) => `block:${b}`));
    return { claimable: false, reasons };
  }
  const gatewayMediated =
    caps.toolMediation === "gateway" ||
    caps.toolMediation === "gateway-mediated";
  if (!selection.preferAcp && !gatewayMediated) {
    reasons.push("ACP/mediation not preferred for default claim");
    return { claimable: false, reasons };
  }
  reasons.push("cutover-ready");
  return { claimable: true, reasons };
}
