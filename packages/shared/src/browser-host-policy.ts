/**
 * Policy gate used by the Electron host (MCP /exec and host bridge).
 * Main process is the single owner of browser policy decisions.
 */
import {
  evaluateBrowserToolRequest,
  rememberApprovedOrigin,
  type BrowserPolicySession,
  type BrowserToolName,
  type BrowserToolRequest,
} from "./browser-policy.js";
import type { PolicySnapshot } from "./types.js";
import type { PolicyResult } from "./policy.js";

export type BrowserHostTaskState = {
  policy: PolicySnapshot;
  session: BrowserPolicySession;
  configured: true;
};

export function createBrowserHostTaskState(
  policy: PolicySnapshot,
): BrowserHostTaskState {
  return {
    configured: true,
    policy: {
      approvalMode: policy.approvalMode,
      workspaceRoots: [...policy.workspaceRoots],
      allowNetworkTools: policy.allowNetworkTools,
      allowShell: policy.allowShell,
    },
    session: { approvedOrigins: new Set(), elevatedNetwork: false },
  };
}

export function decideBrowserHostTool(
  state: BrowserHostTaskState,
  req: BrowserToolRequest,
): PolicyResult {
  return evaluateBrowserToolRequest(state.policy, req, state.session);
}

/** After a successful browser_open (or user approval), remember origin. */
export function noteBrowserOpenAllowed(
  state: BrowserHostTaskState,
  url: string,
): void {
  rememberApprovedOrigin(state.session, url);
}

export function browserToolRequestFromArgs(
  tool: string,
  args: Record<string, unknown>,
): BrowserToolRequest | null {
  const allowed: BrowserToolName[] = [
    "browser_open",
    "browser_click",
    "browser_type",
    "browser_scroll",
    "browser_screenshot",
    "browser_read",
  ];
  if (!allowed.includes(tool as BrowserToolName)) return null;
  // Prefer url; desk-browser / Grok often pass absolute HTML as `path`.
  const url =
    typeof args.url === "string" && args.url.trim()
      ? args.url
      : typeof args.path === "string" && args.path.trim()
        ? args.path
        : undefined;
  return {
    tool: tool as BrowserToolName,
    url,
    submit: args.submit === true ? true : undefined,
    download: args.download === true ? true : undefined,
  };
}

export type BrowserAuthorizeResult =
  | { ok: true; canonicalUrl?: string }
  | { ok: false; output: string; needsApproval?: boolean; approvalId?: string };
