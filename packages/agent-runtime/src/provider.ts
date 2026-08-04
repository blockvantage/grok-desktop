import type { RuntimeEventSink } from "./events.js";
import type {
  EffectivePolicy,
  ModelDescriptor,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRef,
  ProviderSessionBinding,
} from "./types.js";

export interface SessionInput {
  ref: ProviderRef;
  cwd: string;
  workspaceRoots: string[];
  policy: EffectivePolicy;
  systemPreamble?: string;
  /** Isolated provider home / config when isolation is requested. */
  isolatedProfileDir?: string;
  inheritUserConfig?: boolean;
  /** Start in plan mode when the provider supports session/set_mode. */
  planFirst?: boolean;
}

export interface TurnInput {
  goal: string;
  attachments?: Array<{ path: string; mime?: string }>;
}

export interface TurnResult {
  status: "done" | "failed" | "cancelled" | "waiting_permission";
  summary?: string;
  providerSessionId?: string;
}

export interface AgentSession {
  readonly binding: ProviderSessionBinding;
  runTurn(input: TurnInput, sink: RuntimeEventSink): Promise<TurnResult>;
  cancel(reason: string): Promise<void>;
  /**
   * Mid-run aside. Returns false when the provider extension is unsupported.
   * Pass clientMutationId when available so the provider can dedupe replays.
   */
  interject?(
    text: string,
    opts?: { clientMutationId?: string },
  ): Promise<boolean>;
  /** Compact conversation. Returns false when unsupported. */
  compact?(): Promise<boolean>;
  /** Rewind points from x.ai/rewind/points. Null when unsupported. */
  rewindPoints?(): Promise<Array<{
    id: string;
    label?: string;
    files?: string[];
    hasFileChanges?: boolean;
  }> | null>;
  rewindTo?(pointId: string): Promise<boolean>;
}

export interface AgentProvider {
  readonly id: string;
  probe(): Promise<ProviderHealth>;
  listModels(): Promise<ModelDescriptor[]>;
  getCapabilities(modelId: string): Promise<ProviderCapabilities>;
  createSession(input: SessionInput): Promise<AgentSession>;
  /**
   * Resume a prior provider session. Optional `input` supplies real policy/cwd
   * when available (callers that only have a binding may omit it).
   */
  resumeSession(
    binding: ProviderSessionBinding,
    input?: SessionInput,
  ): Promise<AgentSession>;
}

/**
 * Fail closed when a run needs mediation the provider cannot supply.
 */
export function assertPolicyCompatible(
  caps: ProviderCapabilities,
  policy: EffectivePolicy,
): { ok: true } | { ok: false; reason: string } {
  const needsMediation =
    policy.approvalMode === "strict" ||
    policy.capabilities.some((c) => c.decision === "deny" || c.decision === "ask");

  if (!needsMediation) return { ok: true };

  if (caps.toolMediation === "uncontrolled" || !caps.policyEnforceable) {
    return {
      ok: false,
      reason:
        "Provider cannot enforce requested policy (uncontrolled tool mediation). " +
        "Fail closed or run in explicit degraded mode.",
    };
  }
  return { ok: true };
}
