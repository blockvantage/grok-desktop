/**
 * Provider-neutral runtime types (PORT-01 / Phase 3).
 * Gateway and UI should depend on these contracts, not vendor packages.
 */

export type ProviderRef = {
  providerId: string;
  modelId: string;
};

export type ToolMediation =
  | "gateway"
  | "provider-permission-rpc"
  | "uncontrolled";

export type SessionCapability = "none" | "resume" | "branch";

export type Modality = "text" | "image" | "audio" | "video";

export interface ProviderCapabilities {
  sessions: SessionCapability;
  toolMediation: ToolMediation;
  sandboxProfiles: string[];
  supportsMcp: boolean;
  supportsUsage: boolean;
  supportsArtifacts: boolean;
  modalities: Modality[];
  /** When false, policy that requires mediation cannot be claimed. */
  policyEnforceable: boolean;
}

export interface ModelDescriptor {
  id: string;
  displayName: string;
  providerId: string;
  modalities: Modality[];
  contextWindow?: number;
}

export interface ProviderHealth {
  ok: boolean;
  providerId: string;
  version?: string;
  message?: string;
  authenticated: boolean;
}

export interface ProviderSessionBinding {
  providerId: string;
  providerSessionId: string;
  modelId: string;
  createdAt: string;
}

export type PolicyDecision = "allow" | "deny" | "ask";

export interface PolicyCapability {
  id: string;
  decision: PolicyDecision;
  reason?: string;
}

/** Neutral policy IR snapshot for a run. */
export interface EffectivePolicy {
  version: string;
  approvalMode: "strict" | "balanced" | "autopilot";
  workspaceRoots: string[];
  capabilities: PolicyCapability[];
  maxDurationMs?: number;
  maxToolCalls?: number;
}

export interface UsageSnapshot {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  contextWindow?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export type RuntimeErrorCode =
  | "provider_unavailable"
  | "auth_required"
  | "policy_denied"
  | "unsupported_capability"
  | "cancelled"
  | "timeout"
  | "malformed_event"
  | "internal";

export interface RuntimeError {
  code: RuntimeErrorCode;
  message: string;
  retriable: boolean;
  details?: Record<string, unknown>;
}
