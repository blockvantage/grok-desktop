import {
  isBlockedBrowserUrl,
  hasBrowserUrlControlCharacters,
  isLocalHtmlDeliverable,
  originOf,
  parseBrowserUrl,
} from "./browser-url.js";
import type { PolicySnapshot } from "./types.js";
import type { PolicyResult } from "./policy.js";

export type BrowserToolName =
  | "browser_open"
  | "browser_click"
  | "browser_type"
  | "browser_scroll"
  | "browser_screenshot"
  | "browser_read";

export type BrowserToolRequest = {
  tool: BrowserToolName;
  url?: string;
  /** browser_type: pressing Enter / form submit */
  submit?: boolean;
  /** future: download */
  download?: boolean;
};

export type BrowserPolicySession = {
  approvedOrigins: Set<string>;
  elevatedNetwork: boolean;
};

export function evaluateBrowserToolRequest(
  policy: PolicySnapshot,
  req: BrowserToolRequest,
  session: BrowserPolicySession,
): PolicyResult {
  if (!policy.allowNetworkTools) {
    return { decision: "deny", reason: "Network tools disabled" };
  }

  if (req.tool === "browser_open") {
    const input = req.url ?? "";
    if (hasBrowserUrlControlCharacters(input)) {
      return { decision: "deny", reason: "URL contains control characters" };
    }
    const raw = input.trim();
    const block = isBlockedBrowserUrl(raw);
    if (block.blocked && !session.elevatedNetwork) {
      return { decision: "deny", reason: block.reason ?? "Blocked URL" };
    }

    // Local HTML deliverables (absolute path or file://…/*.html):
    // - no real http origin (file origin is the string "null")
    // - must NEVER park as "First visit to null requires approval" (hangs agent)
    // Balanced/autopilot always allow; only strict asks once.
    if (isLocalHtmlDeliverable(raw)) {
      if (policy.approvalMode === "strict") {
        return {
          decision: "needs_approval",
          reason: "Strict mode requires approval for opening local HTML",
        };
      }
      return {
        decision: "allow",
        reason: "Local HTML deliverable (in-app pane)",
      };
    }

    const url = parseBrowserUrl(raw);
    if (!url) return { decision: "deny", reason: "Invalid URL" };

    // file: non-HTML already blocked above; file: HTML should hit isLocalHtmlDeliverable.
    // Belt-and-suspenders: never origin-gate opaque/null origins.
    if (url.protocol === "file:") {
      if (/\.html?$/i.test(url.pathname)) {
        if (policy.approvalMode === "strict") {
          return {
            decision: "needs_approval",
            reason: "Strict mode requires approval for opening local HTML",
          };
        }
        return {
          decision: "allow",
          reason: "Local HTML deliverable (in-app pane)",
        };
      }
      return { decision: "deny", reason: "file:// URLs are not allowed" };
    }

    const origin = originOf(url);
    if (!origin || origin === "null") {
      return { decision: "deny", reason: "Invalid URL origin" };
    }

    if (policy.approvalMode === "autopilot") {
      return { decision: "allow", reason: "Autopilot browser open" };
    }
    if (policy.approvalMode === "strict") {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval for navigation",
      };
    }
    if (session.approvedOrigins.has(origin)) {
      return { decision: "allow", reason: "Origin already approved" };
    }
    return {
      decision: "needs_approval",
      reason: `First visit to ${origin} requires approval`,
    };
  }

  const isSubmit = req.submit === true || req.download === true;

  if (policy.approvalMode === "autopilot") {
    return { decision: "allow", reason: "Autopilot browser action" };
  }

  if (policy.approvalMode === "strict") {
    if (
      req.tool === "browser_click" ||
      req.tool === "browser_type" ||
      isSubmit
    ) {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval for browser interaction",
      };
    }
    return { decision: "allow", reason: "Observe-only browser tool" };
  }

  if (isSubmit) {
    return {
      decision: "needs_approval",
      reason: "Form submit / download requires approval",
    };
  }
  return { decision: "allow", reason: "Browser action allowed" };
}

/** Soft cap on remembered approved origins per browser task session. */
export const MAX_APPROVED_ORIGINS = 64;

/** Call after user approves browser_open for a URL. */
export function rememberApprovedOrigin(
  session: BrowserPolicySession,
  url: string,
): void {
  const u = parseBrowserUrl(url);
  if (!u) return;
  const origin = originOf(u);
  if (session.approvedOrigins.has(origin)) return;
  // Set has no FIFO; drop an arbitrary entry when full.
  if (session.approvedOrigins.size >= MAX_APPROVED_ORIGINS) {
    const first = session.approvedOrigins.values().next().value as
      | string
      | undefined;
    if (first !== undefined) session.approvedOrigins.delete(first);
  }
  session.approvedOrigins.add(origin);
}

export function isBrowserToolName(tool: string): tool is BrowserToolName {
  return (
    tool === "browser_open" ||
    tool === "browser_click" ||
    tool === "browser_type" ||
    tool === "browser_scroll" ||
    tool === "browser_screenshot" ||
    tool === "browser_read"
  );
}
