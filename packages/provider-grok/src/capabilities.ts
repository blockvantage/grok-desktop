import type { ProviderCapabilities } from "@grokdesk/agent-runtime";

/**
 * Headless streaming adapter capabilities — explicitly degraded.
 * Full ACP mediation is not claimed until conformance proves it.
 */
export const GROK_HEADLESS_CAPABILITIES: ProviderCapabilities = {
  sessions: "none",
  toolMediation: "uncontrolled",
  sandboxProfiles: [],
  supportsMcp: true,
  supportsUsage: false,
  supportsArtifacts: false,
  modalities: ["text", "image", "video"],
  policyEnforceable: false,
};

/**
 * Target ACP adapter capabilities (live on `grok agent stdio`).
 * Negotiated from initialize; extra unknown fields are ignored.
 */
export const GROK_ACP_TARGET_CAPABILITIES: ProviderCapabilities = {
  sessions: "resume",
  toolMediation: "provider-permission-rpc",
  sandboxProfiles: ["workspace", "read-only", "none"],
  supportsMcp: true,
  supportsUsage: true,
  supportsArtifacts: true,
  modalities: ["text", "image", "video"],
  policyEnforceable: true,
};
