import { isPathInsideAnyRoot } from "./paths.js";
import { classifyBalancedShellCommand } from "./safe-shell-command.js";
import type { PolicySnapshot } from "./types.js";

export type ToolName =
  | "read_file"
  | "write_file"
  | "delete_file"
  | "shell"
  | "network"
  | "media"
  | "browser_open"
  | "browser_click"
  | "browser_type"
  | "browser_scroll"
  | "browser_screenshot"
  | "browser_read"
  | "other";

export interface ToolRequest {
  tool: ToolName;
  path?: string;
  command?: string;
  meta?: Record<string, unknown>;
}

export type PolicyDecision = "allow" | "deny" | "needs_approval";

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

export function evaluateToolRequest(
  policy: PolicySnapshot,
  req: ToolRequest,
): PolicyResult {
  // Browser tools use evaluateBrowserToolRequest when session state is available.
  // Fallback: gate only on network flag so unknown paths stay safe.
  if (req.tool.startsWith("browser_")) {
    if (!policy.allowNetworkTools) {
      return { decision: "deny", reason: "Network tools disabled" };
    }
    return { decision: "allow", reason: "Browser tool — use browser policy" };
  }

  if (req.path) {
    if (!isPathInsideAnyRoot(req.path, policy.workspaceRoots)) {
      return {
        decision: "deny",
        reason: "Path is outside configured workspace roots",
      };
    }
  }

  if (req.tool === "shell") {
    if (!policy.allowShell) {
      return { decision: "deny", reason: "Shell is disabled by policy" };
    }
    if (policy.approvalMode === "autopilot") {
      return { decision: "allow", reason: "Autopilot allows shell" };
    }
    if (policy.approvalMode === "balanced" && req.command) {
      const classification = classifyBalancedShellCommand(
        req.command,
        policy.workspaceRoots,
      );
      if (classification.safe) {
        return {
          decision: "allow",
          reason:
            classification.reason === "verification"
              ? "Recognized project verification command"
              : "Recognized read-only workspace command",
        };
      }
    }
    return {
      decision: "needs_approval",
      reason: "Unclassified shell command requires approval",
    };
  }

  if (req.tool === "network") {
    if (!policy.allowNetworkTools) {
      return { decision: "deny", reason: "Network tools disabled" };
    }
    if (policy.approvalMode === "strict") {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval",
      };
    }
    return { decision: "allow", reason: "Network tools allowed" };
  }

  if (req.tool === "delete_file") {
    if (policy.approvalMode === "autopilot") {
      return { decision: "allow", reason: "Autopilot allows delete" };
    }
    return {
      decision: "needs_approval",
      reason: "Deletes require approval",
    };
  }

  if (req.tool === "write_file") {
    if (policy.approvalMode === "strict") {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval for writes",
      };
    }
    return { decision: "allow", reason: "Write inside workspace allowed" };
  }

  if (req.tool === "read_file") {
    if (policy.approvalMode === "strict") {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval for reads",
      };
    }
    return { decision: "allow", reason: "Read inside workspace allowed" };
  }

  if (policy.approvalMode === "strict") {
    return {
      decision: "needs_approval",
      reason: "Strict mode requires approval",
    };
  }

  return { decision: "allow", reason: "Default allow" };
}
