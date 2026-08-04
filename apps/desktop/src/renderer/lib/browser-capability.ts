/**
 * Explicit in-app browser capability handshake (not prompt-text preference).
 */

export type BrowserCapabilityStatus =
  | "unavailable"
  | "starting"
  | "ready"
  | "degraded"
  | "blocked"
  | "error";

export type BrowserCapabilityReason =
  | "host_missing"
  | "mcp_spawn_failed"
  | "tools_not_discovered"
  | "policy_blocked"
  | "user_external_choice"
  | "healthy"
  | "unknown";

export type BrowserProvider = "desk-browser" | "external-chrome" | "none";

export type BrowserCapability = {
  status: BrowserCapabilityStatus;
  reason: BrowserCapabilityReason;
  tools: string[];
  provider: BrowserProvider;
  /** User explicitly allowed external browser for this task/conversation. */
  externalAllowed: boolean;
  lastError: string | null;
  verifiedAt: string | null;
};

export function initialBrowserCapability(): BrowserCapability {
  return {
    status: "unavailable",
    reason: "unknown",
    tools: [],
    provider: "none",
    externalAllowed: false,
    lastError: null,
    verifiedAt: null,
  };
}

export type BrowserCapabilityEvent =
  | {
      type: "handshake";
      ok: boolean;
      tools?: string[];
      reason?: BrowserCapabilityReason;
      error?: string | null;
      at?: string;
    }
  | { type: "starting" }
  | { type: "degraded"; reason: BrowserCapabilityReason; error?: string }
  | { type: "blocked"; reason?: BrowserCapabilityReason; error?: string }
  | { type: "error"; error: string }
  | { type: "allow_external"; allowed: boolean }
  | { type: "reset" };

export function reduceBrowserCapability(
  state: BrowserCapability,
  event: BrowserCapabilityEvent,
): BrowserCapability {
  switch (event.type) {
    case "reset":
      return initialBrowserCapability();
    case "starting":
      return {
        ...state,
        status: "starting",
        lastError: null,
      };
    case "handshake": {
      if (event.ok) {
        const tools = event.tools ?? state.tools;
        return {
          ...state,
          status: tools.length > 0 ? "ready" : "degraded",
          reason: tools.length > 0 ? "healthy" : "tools_not_discovered",
          tools,
          provider: "desk-browser",
          lastError: null,
          verifiedAt: event.at ?? new Date().toISOString(),
        };
      }
      return {
        ...state,
        status: "unavailable",
        reason: event.reason ?? "mcp_spawn_failed",
        provider: "none",
        lastError: event.error ?? null,
        verifiedAt: event.at ?? new Date().toISOString(),
      };
    }
    case "degraded":
      return {
        ...state,
        status: "degraded",
        reason: event.reason,
        lastError: event.error ?? state.lastError,
      };
    case "blocked":
      return {
        ...state,
        status: "blocked",
        reason: event.reason ?? "policy_blocked",
        lastError: event.error ?? state.lastError,
      };
    case "error":
      return {
        ...state,
        status: "error",
        lastError: event.error,
      };
    case "allow_external":
      return {
        ...state,
        externalAllowed: event.allowed,
        provider: event.allowed ? "external-chrome" : state.provider === "external-chrome" ? "none" : state.provider,
        reason: event.allowed ? "user_external_choice" : state.reason,
      };
    default:
      return state;
  }
}

/**
 * Whether agent work may use an external Chrome/headless tool.
 * Silent fallback is forbidden — requires explicit user choice.
 */
export function mayUseExternalBrowser(cap: BrowserCapability): boolean {
  return cap.externalAllowed === true;
}

/**
 * Whether desk-browser should be advertised to the engine before a run.
 */
export function shouldAdvertiseDeskBrowser(cap: BrowserCapability): boolean {
  return cap.status === "ready" || cap.status === "degraded";
}

/** Globe control visual state derived from capability + activity. */
export type BrowserGlobeState =
  | "unavailable"
  | "starting"
  | "ready"
  | "active"
  | "blocked"
  | "error"
  | "degraded";

export function browserGlobeState(
  cap: BrowserCapability,
  opts?: { activityOpen?: boolean },
): BrowserGlobeState {
  if (cap.status === "error") return "error";
  if (cap.status === "blocked") return "blocked";
  if (cap.status === "starting") return "starting";
  if (cap.status === "unavailable") return "unavailable";
  if (cap.status === "degraded") return "degraded";
  if (opts?.activityOpen) return "active";
  return "ready";
}

/** Receipt field for browse operations. */
export function browserProviderReceipt(
  cap: BrowserCapability,
): { browserProvider: BrowserProvider; capabilityStatus: BrowserCapabilityStatus } {
  return {
    browserProvider: cap.provider,
    capabilityStatus: cap.status,
  };
}
