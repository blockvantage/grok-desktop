import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBrowserHostTaskState,
  decideBrowserHostTool,
  noteBrowserOpenAllowed,
  browserToolRequestFromArgs,
  isLocalHtmlDeliverable,
  type BrowserHostTaskState,
  type BrowserAuthorizeResult,
  type PolicySnapshot,
  type BrowserToolRequest,
} from "@grokdesk/shared";

export type BrowserApprovalRequest = {
  approvalId: string;
  taskId: string;
  tool: string;
  reason: string;
  url?: string;
  args: Record<string, unknown>;
};

type PendingApproval = {
  approvalId: string;
  taskId: string;
  resolve: (decision: "approve" | "reject") => void;
};

export type BrowserAuthorizationContext = {
  /** Only the gateway's explicit browser.openHtml renderer RPC may set this. */
  source: "renderer_user" | "agent";
};

type CanonicalRequest =
  | { ok: true; request: BrowserToolRequest; canonicalUrl?: string }
  | { ok: false; output: string };

function isContainedBy(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function localPathFromUrl(raw: string): string | null {
  if (raw.startsWith("file:")) {
    try {
      return fileURLToPath(new URL(raw));
    } catch {
      return null;
    }
  }
  return path.isAbsolute(raw) ? raw : null;
}

export function canonicalizeBrowserRequest(
  policy: PolicySnapshot,
  request: BrowserToolRequest,
): CanonicalRequest {
  if (request.tool !== "browser_open" || !request.url) {
    return { ok: true, request };
  }
  const raw = request.url;
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return { ok: false, output: "URL contains control characters" };
  }
  const inputPath = localPathFromUrl(raw.trim());
  if (!inputPath) return { ok: true, request: { ...request, url: raw.trim() } };
  if (!/\.html?$/i.test(inputPath)) {
    return { ok: false, output: "Only local HTML files may open in the browser" };
  }
  let target: string;
  try {
    target = realpathSync(inputPath);
  } catch {
    return { ok: false, output: `Local browser file not found: ${inputPath}` };
  }
  const roots = policy.workspaceRoots.flatMap((root) => {
    try {
      return [realpathSync(root)];
    } catch {
      return [];
    }
  });
  if (!roots.some((root) => isContainedBy(root, target))) {
    return {
      ok: false,
      output: "Local browser file is outside the authorized workspace roots",
    };
  }
  return {
    ok: true,
    request: { ...request, url: target },
    canonicalUrl: target,
  };
}

/**
 * Single owner of browser policy for the main process (MCP + host bridge).
 * Unconfigured tasks hard-fail. needs_approval parks until resolveApproval.
 */
/** Cap concurrent browser task states (chat roots). */
export const BROWSER_POLICY_MAX_TASKS = 512;

export class BrowserPolicyStore {
  private map = new Map<string, BrowserHostTaskState>();
  private pending = new Map<string, PendingApproval>();
  private onApprovalNeeded:
    | ((req: BrowserApprovalRequest) => void | Promise<void>)
    | null = null;

  setApprovalHandler(
    fn: (req: BrowserApprovalRequest) => void | Promise<void>,
  ): void {
    this.onApprovalNeeded = fn;
  }

  isConfigured(taskId: string): boolean {
    return this.map.has(taskId);
  }

  configure(taskId: string, policy: PolicySnapshot): void {
    if (!this.map.has(taskId)) {
      while (this.map.size >= BROWSER_POLICY_MAX_TASKS) {
        const oldest = this.map.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.map.delete(oldest);
        // Drop pending approvals for the evicted task.
        for (const [id, p] of this.pending) {
          if (p.taskId === oldest) this.pending.delete(id);
        }
      }
    }
    this.map.set(taskId, createBrowserHostTaskState(policy));
  }

  rememberOrigin(taskId: string, url: string): void {
    const state = this.map.get(taskId);
    if (!state) return;
    noteBrowserOpenAllowed(state, url);
  }

  /**
   * Re-resolve a local HTML leaf immediately before loadFile without prompting
   * again. This closes swaps between the original approval and execution. The
   * OS can still replace a path after realpath and before open; loadFile offers
   * no descriptor-based API, so this check is intentionally adjacent to load.
   */
  revalidateLocal(taskId: string, url: string): BrowserAuthorizeResult {
    const state = this.map.get(taskId);
    if (!state) {
      return {
        ok: false,
        output: "Browser session not configured for this task",
      };
    }
    const request = browserToolRequestFromArgs("browser_open", { url });
    if (!request) return { ok: false, output: "Invalid local browser target" };
    const canonical = canonicalizeBrowserRequest(state.policy, request);
    if (!canonical.ok) return canonical;
    if (!canonical.canonicalUrl) {
      return { ok: false, output: "Expected a local HTML browser target" };
    }
    return { ok: true, canonicalUrl: canonical.canonicalUrl };
  }

  /**
   * Authorize a browser tool. May wait for interactive approval.
   * Hard-fails if the task was never configured by the gateway.
   */
  async authorize(
    taskId: string,
    tool: string,
    args: Record<string, unknown>,
    context: BrowserAuthorizationContext = { source: "agent" },
  ): Promise<BrowserAuthorizeResult> {
    const state = this.map.get(taskId);
    if (!state) {
      return {
        ok: false,
        output:
          "Browser session not configured for this task (gateway must call browser.configure first)",
      };
    }

    const parsed = browserToolRequestFromArgs(tool, args);
    if (!parsed) {
      return { ok: false, output: `Unknown browser tool: ${tool}` };
    }
    const canonical = canonicalizeBrowserRequest(state.policy, parsed);
    if (!canonical.ok) return canonical;
    const req = canonical.request;

    const decision = decideBrowserHostTool(state, req);
    if (decision.decision === "allow") {
      if (req.tool === "browser_open" && req.url) {
        noteBrowserOpenAllowed(state, req.url);
      }
      return { ok: true, canonicalUrl: canonical.canonicalUrl };
    }
    if (decision.decision === "deny") {
      return { ok: false, output: decision.reason };
    }

    // The click itself is the user's strict-mode approval for this exact local
    // file. Agent/MCP/harvest opens still use the normal approval surface.
    // This exception is evaluated only after the task's unchanged policy has
    // allowed browser capability, so it cannot elevate a no-network task.
    if (
      context.source === "renderer_user" &&
      req.tool === "browser_open" &&
      req.url &&
      isLocalHtmlDeliverable(req.url)
    ) {
      noteBrowserOpenAllowed(state, req.url);
      return { ok: true, canonicalUrl: canonical.canonicalUrl };
    }

    // needs_approval — park until user decides (Desk UI via gateway)
    const approvalId = randomUUID();
    const url = req.url;
    // Register pending BEFORE notify so approve cannot race past an empty map.
    const waitUser = new Promise<"approve" | "reject">((resolve) => {
      this.pending.set(approvalId, { approvalId, taskId, resolve });
    });
    try {
      await this.onApprovalNeeded?.({
        approvalId,
        taskId,
        tool,
        reason: decision.reason,
        url,
        args: canonical.canonicalUrl
          ? { ...args, url: canonical.canonicalUrl, path: canonical.canonicalUrl }
          : args,
      });
    } catch {
      // still wait — user may approve via other paths
    }

    const userDecision = await waitUser;

    if (userDecision === "reject") {
      return {
        ok: false,
        output: "User rejected browser action",
        needsApproval: true,
        approvalId,
      };
    }

    if (req.tool === "browser_open" && url) {
      noteBrowserOpenAllowed(state, url);
    }
    return { ok: true, canonicalUrl: canonical.canonicalUrl };
  }

  /** Resolve a parked approval (from gateway tasks.approve or renderer). */
  resolveApproval(
    approvalId: string,
    decision: "approve" | "reject",
  ): boolean {
    const p = this.pending.get(approvalId);
    if (!p) return false;
    this.pending.delete(approvalId);
    p.resolve(decision);
    return true;
  }

  /** Cancel all parked approvals for a task (task end / pause). */
  cancelTask(taskId: string): void {
    for (const [id, p] of this.pending) {
      if (p.taskId === taskId) {
        this.pending.delete(id);
        p.resolve("reject");
      }
    }
  }

  delete(taskId: string): void {
    this.cancelTask(taskId);
    this.map.delete(taskId);
  }

  /** Sync test helper — non-async gate used by unit tests for allow/deny only. */
  gate(
    taskId: string,
    tool: string,
    args: Record<string, unknown>,
  ): { ok: false; output: string; needsApproval?: boolean } | null {
    const state = this.map.get(taskId);
    if (!state) {
      return {
        ok: false,
        output:
          "Browser session not configured for this task (gateway must call browser.configure first)",
      };
    }
    const parsed = browserToolRequestFromArgs(tool, args);
    if (!parsed) return { ok: false, output: `Unknown browser tool: ${tool}` };
    const canonical = canonicalizeBrowserRequest(state.policy, parsed);
    if (!canonical.ok) return canonical;
    const req = canonical.request;
    const decision = decideBrowserHostTool(state, req);
    if (decision.decision === "allow") {
      if (req.tool === "browser_open" && req.url) {
        noteBrowserOpenAllowed(state, req.url);
      }
      return null;
    }
    if (decision.decision === "deny") {
      return { ok: false, output: decision.reason };
    }
    return {
      ok: false,
      output: decision.reason,
      needsApproval: true,
    };
  }
}
