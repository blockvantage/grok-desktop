/**
 * Map ACP permission requests to EffectivePolicy decisions.
 * One identifiable authorizer for provider-permission-rpc mediation (SEC-01).
 */
import type { EffectivePolicy, PolicyDecision } from "@grokdesk/agent-runtime";
import type { AcpPermissionDecision } from "./acp-jsonrpc.js";

export interface PermissionBrokerResult {
  decision: AcpPermissionDecision;
  policyDecision: PolicyDecision;
  capabilityId: string;
  reason: string;
}

/**
 * Normalize ACP tool kind / title into a capability id used by Desk policy.
 */
export function capabilityIdFromPermission(opts: {
  kind?: string;
  title?: string;
}): string {
  const kind = (opts.kind ?? "").toLowerCase();
  const title = (opts.title ?? "").toLowerCase();
  const blob = `${kind} ${title}`;
  if (
    /\bshell\b|\bbash\b|\bterminal\b|\bexec\b|\bcommand\b/.test(blob)
  ) {
    return "shell";
  }
  if (/\bnetwork\b|\bhttp\b|\bfetch\b|\bweb\b|\burl\b/.test(blob)) {
    return "network";
  }
  if (/\bmcp\b/.test(blob)) return "mcp";
  if (/\bbrowser\b/.test(blob)) return "browser";
  if (/\bdesktop\b|\bscreen\b/.test(blob)) return "desktop";
  if (/\bsecret\b|\bcredential\b|\bkeychain\b/.test(blob)) return "secret";
  if (/\bwrite\b|\bedit\b|\bfile\b|\bfs\b/.test(blob)) return "filesystem";
  // Unknown kinds default to shell-like effect class (fail closed under strict).
  return kind || "shell";
}

/**
 * Resolve an ACP permission request against the run's effective policy.
 * Fail closed: missing capability under strict → deny; under balanced → ask→deny
 * unless explicitly allow.
 */
export function resolveAcpPermission(
  policy: EffectivePolicy,
  opts: { kind?: string; title?: string },
): PermissionBrokerResult {
  const capabilityId = capabilityIdFromPermission(opts);
  const cap = policy.capabilities.find((c) => c.id === capabilityId);
  const decision: PolicyDecision =
    cap?.decision ??
    (policy.approvalMode === "autopilot"
      ? "allow"
      : policy.approvalMode === "strict"
        ? "deny"
        : "ask");

  if (decision === "allow") {
    return {
      decision: "allow",
      policyDecision: "allow",
      capabilityId,
      reason: cap?.reason ?? `policy allows ${capabilityId}`,
    };
  }
  if (decision === "deny") {
    return {
      decision: "deny",
      policyDecision: "deny",
      capabilityId,
      reason: cap?.reason ?? `policy denies ${capabilityId}`,
    };
  }
  // ask: without a live UI approver, fail closed (deny) for automated runs.
  return {
    decision: "deny",
    policyDecision: "ask",
    capabilityId,
    reason:
      cap?.reason ??
      `policy requires approval for ${capabilityId}; no approver attached (fail closed)`,
  };
}

/**
 * Convert broker result to ACP outcome when a human approver is attached.
 */
export function applyApproverOverride(
  broker: PermissionBrokerResult,
  human: AcpPermissionDecision | null,
): AcpPermissionDecision {
  if (broker.policyDecision === "deny") return "deny";
  if (broker.policyDecision === "allow") return "allow";
  // ask: human decision wins when provided
  if (human === "allow" || human === "allow_once") return human;
  return "deny";
}
