/**
 * Composition root for agent providers (Phase 3/5).
 * Domain services depend on neutral contracts; concrete adapters register here only.
 * Grok = adapter one; Echo = adapter two (gateway-mediated, no paid API).
 */
import path from "node:path";
import {
  ProviderRegistry,
  FakeAgentProvider,
  assertPolicyCompatible,
  type EffectivePolicy,
  type ProviderCapabilities,
  type SessionInput,
} from "@grokdesk/agent-runtime";
import {
  GrokAgentProvider,
  spawnAcpLineTransport,
  type AcpLineTransport,
} from "@grokdesk/provider-grok";
import { EchoAgentProvider } from "@grokdesk/provider-echo";
import {
  buildAcpSpawnArgs,
  policySnapshotFromEffective,
} from "@grokdesk/shared";

function pathIsAbsolute(p: string): boolean {
  return path.isAbsolute(p);
}

export function createDefaultProviderRegistry(opts?: {
  includeFake?: boolean;
  /** When false, skip second-provider echo registration (default: register). */
  includeEcho?: boolean;
  /**
   * Prefer ACP mediation when true. Still requires acpTransportFactory for
   * live sessions. Packaged composition ignores ambient ACP/dev overrides.
   */
  preferAcp?: boolean;
  /** Explicit trusted managed Grok binary for the auto stdio factory. */
  acpBinary?: string;
  acpTransportFactory?: (
    input: SessionInput,
  ) => AcpLineTransport | Promise<AcpLineTransport>;
  /** Optional live model catalog source (auth-session list). */
  models?: () => Promise<
    Array<{
      id: string;
      displayName: string;
      providerId: string;
      modalities?: Array<"text" | "image" | "video" | "audio">;
    }>
  >;
  onAuthorizationReceipt?: (receipt: {
    action: string;
    decision: "allow" | "deny" | "ask";
    capabilityId: string;
    kind?: string;
    title?: string;
    reason: string;
  }) => void;
}): ProviderRegistry {
  const reg = new ProviderRegistry();
  const e2eFakeProvider =
    process.env.GROKDESK_E2E === "1" &&
    process.env.GROKDESK_PROVIDER_ENGINE === "1" &&
    process.env.GROKDESK_PROVIDER_ID === "fake";
  const packaged = process.env.GROKDESK_PACKAGED === "1";
  const envAcp = !packaged && process.env.GROKDESK_ACP === "1";
  const acpRequested = opts?.preferAcp === true || envAcp;
  const trustedBinary =
    opts?.acpBinary?.trim() ||
    process.env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED?.trim() ||
    "";
  // Explicit factory from composition (probe-gated) takes precedence over env.
  // Fallback still compiles sandbox when GROKDESK_ACP_SANDBOX is not explicitly off.
  // Prefer createLiveAcpTransportFactory (probe.supportsSandbox) in production.
  const acpTransportFactory =
    opts?.acpTransportFactory ??
    (acpRequested && pathIsAbsolute(trustedBinary)
      ? (input: SessionInput) => {
          const policy = policySnapshotFromEffective({
            approvalMode: input.policy.approvalMode,
            workspaceRoots: input.workspaceRoots?.length
              ? input.workspaceRoots
              : [input.cwd],
            capabilities: input.policy.capabilities,
          });
          const supportsSandbox =
            process.env.GROKDESK_ACP_SANDBOX === "1" ||
            process.env.GROKDESK_ACP_SANDBOX === "true";
          const args = buildAcpSpawnArgs({
            cwd: input.cwd,
            policy,
            // Fail closed by default; live factory uses probe.supportsSandbox.
            supportsSandbox,
          });
          return spawnAcpLineTransport({
            binary: trustedBinary,
            args,
            cwd: input.cwd,
            trustedManagedRuntime: true,
          });
        }
      : undefined);
  const preferAcp =
    !!acpTransportFactory &&
    (opts?.preferAcp === true || envAcp || !!opts?.acpTransportFactory);
  // Grok is provider adapter one — registered only at composition root.
  reg.register(
    new GrokAgentProvider({
      mode: preferAcp ? "acp" : "headless-degraded",
      failClosedOnUnenforceablePolicy: true,
      acpTransportFactory,
      models: opts?.models
        ? async () => {
            const list = await opts.models!();
            return list.map((m) => ({
              ...m,
              modalities: m.modalities ?? ["text"],
            }));
          }
        : undefined,
      onAuthorizationReceipt: opts?.onAuthorizationReceipt,
    }),
  );
  // Phase 5: second adapter validates registry neutrality (no paid network).
  if (opts?.includeEcho !== false) {
    reg.register(new EchoAgentProvider());
  }
  if (opts?.includeFake || e2eFakeProvider) {
    reg.register(new FakeAgentProvider());
  }
  return reg;
}

/**
 * Map Desk task policy snapshot into neutral EffectivePolicy for capability checks.
 */
export function deskPolicyToEffective(policy: {
  approvalMode: "strict" | "balanced" | "autopilot";
  workspaceRoots: string[];
  allowShell: boolean;
  allowNetworkTools: boolean;
}): EffectivePolicy {
  const capabilities = [
    {
      id: "shell",
      decision: (policy.allowShell
        ? policy.approvalMode === "autopilot"
          ? "allow"
          : "ask"
        : "deny") as "allow" | "deny" | "ask",
    },
    {
      id: "network",
      decision: (policy.allowNetworkTools
        ? policy.approvalMode === "strict"
          ? "ask"
          : "allow"
        : "deny") as "allow" | "deny" | "ask",
    },
  ];
  return {
    version: "1",
    approvalMode: policy.approvalMode,
    workspaceRoots: policy.workspaceRoots,
    capabilities,
  };
}

/**
 * When using an uncontrolled (headless) Grok path, refuse or mark degraded.
 */
export function evaluateProviderPolicyGate(
  caps: ProviderCapabilities,
  policy: EffectivePolicy,
  opts?: { allowDegraded?: boolean },
):
  | { action: "proceed" }
  | { action: "reject"; reason: string }
  | { action: "degraded"; reason: string } {
  const check = assertPolicyCompatible(caps, policy);
  if (check.ok) return { action: "proceed" };
  if (opts?.allowDegraded) {
    return { action: "degraded", reason: check.reason };
  }
  return { action: "reject", reason: check.reason };
}
