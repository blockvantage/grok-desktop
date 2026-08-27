import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EngineAdapter, NormalizedEngineEvent } from "../engine-types.js";
import {
  checkRunBudget,
  createRunBudgetState,
  evaluateToolRequest,
  isBrowserToolName,
  runBudgetLimitsFromEnv,
  touchRunBudgetActivity,
  type RunBudgetState,
  type Task,
} from "@grokdesk/shared";
// trustedFolders for T5 passed via inheritUserGrokProvider-style optional hook
import {
  rejectHumanPermission,
  resolveHumanPermission,
} from "@grokdesk/agent-runtime";
import type { TaskService } from "./tasks.js";
import type { AuditService } from "./audit.js";
import { NullHostBridge, type HostBridge } from "../host-bridge.js";
import type { RunContext } from "./run-context.js";
import type { RunAttemptService } from "./run-attempts.js";
import type { OperationReceiptService } from "./operation-receipts.js";
import type { DeclaredArtifactService } from "./declared-artifacts.js";
import { evaluateProviderOwnToolsGate } from "./policy-provider-gate.js";
import type { ProviderPreflightFn } from "./provider-preflight.js";
import {
  engineOwnedBrowserCallFromRequest,
  handleBrowserToolRequest,
  recordEngineOwnedBrowserToolResult,
  type EngineOwnedBrowserCall,
} from "./browser-tool-handler.js";
import {
  listDeliverableFiles,
  guessArtifactKind,
  guessArtifactMime,
} from "./workspace-deliverables.js";
import { threadHasActiveBrowserUsers as threadHasActiveBrowserUsersPure } from "./thread-browser-users.js";
import {
  harvestSinceMs,
  selectNewDeliverableArtifacts,
} from "./harvest-deliverables.js";
import { DesktopGrantStore } from "./desktop-grant-store.js";
import {
  policyDecisionToAuditDecision,
  toolPolicyAuditDetail,
  toolPolicyReceiptFields,
} from "./tool-policy-receipts.js";
import {
  writeFilePayload,
  writeFileReceiptDetail,
  writeFileSuccessOutput,
} from "./host-write-file.js";
import { assertPathInsideWorkspaceRoots } from "./workspace-path-confine.js";
import { isUsefulDoneSummary } from "./done-summary.js";
import { resolveLiveThreadTask } from "./live-thread-task.js";
import {
  userApprovedToolReceipt,
  userRejectedToolReceipt,
} from "./user-approval-receipts.js";
import { defaultDesktopMachineSettings } from "./default-desktop-machine.js";
import {
  providerPreflightDegradedReceipt,
  providerPreflightRejectReceipt,
} from "./provider-gate-receipts.js";
import { planPostEngineExit } from "./post-engine-exit.js";
import {
  errorMessageFromUnknown,
  resolveAttemptIdForStart,
} from "./run-attempt-resolve.js";
import {
  browserOpenUrlFromToolMeta,
  buildHostParkedToolRequest,
  hostParkedApprovalRequiredPayload,
  shouldMarkCancelled,
} from "./host-parked-approval.js";
import {
  clampMaxConcurrent,
  selectQueuedStarts,
  shouldSkipStart,
  threadKeyForTask,
  type ThreadTaskLike,
} from "./concurrency.js";
import {
  approvalAuditDetail,
  approvalResolvedEvent,
  cancelRejectedApprovalEvent,
  pendingApprovalIdsForTask,
  shouldRememberBrowserOrigin,
} from "./approval-resolve.js";
import { filterPendingApprovals } from "./pending-approvals.js";
import { RUN_ATTEMPT_LEASE_MS } from "./run-lease.js";
import { knownArtifactPathsFromEvents } from "./known-artifact-paths.js";
import {
  messageEventPayload,
  runProgressStepPayload,
  stepEventPayload,
  toolRequestEventPayload,
  toolResultEventPayload,
  toolResultDeniedPayload,
  toolResultUserRejectedPayload,
  artifactCreatedEventPayload,
  errorEventPayload,
  doneSummaryMessagePayload,
  workerEventPayload,
} from "./engine-event-payloads.js";
import {
  shouldAbortHandleEvent,
  shouldAbortAfterApprovalWait,
} from "./should-abort-handle-event.js";
import { harvestArtifactCreatedPayload } from "./harvest-artifact-payload.js";
import {
  requestIdFromContext,
  systemPreambleFromContext,
} from "./run-context-fields.js";
import { eventTaskIdForHostParkedApproval } from "./host-parked-event-task.js";
import { resolveRunEngine } from "./resolve-run-engine.js";
import {
  desktopConfigureInput,
  hostSessionIdsFromThreadRoot,
} from "./run-task-host-config.js";
import {
  planFromEngineOwnToolsGate,
  planFromProviderPreflight,
} from "./run-task-preflight-apply.js";
import type { EntitlementGuard } from "./entitlement-guard.js";
import {
  isEntitlementReadOnlyError,
  type EntitlementReadOnlyError,
} from "./entitlement-error.js";
import { requireGrokAdmission } from "./entitlement-admission.js";
import type { DesktopLicenseState } from "@grokdesk/shared";

export {
  listDeliverableFiles,
  guessArtifactKind,
  guessArtifactMime,
} from "./workspace-deliverables.js";

/** True for HTML pages we should auto-open in the agent browser pane. */
function isHtmlDeliverablePath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base.endsWith(".html") || base.endsWith(".htm");
}

/**
 * Prefer index.html, then any recent .html under a workspace (shallow walk).
 */
function findBestHtmlInWorkspace(root: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsSync = require("node:fs") as typeof import("node:fs");
    const index = path.join(root, "index.html");
    if (fsSync.existsSync(index)) return index;
    const candidates: { p: string; mtime: number; score: number }[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 3) return;
      let entries: import("node:fs").Dirent[];
      try {
        entries = fsSync.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full, depth + 1);
          continue;
        }
        if (!isHtmlDeliverablePath(ent.name)) continue;
        let mtime = 0;
        try {
          mtime = fsSync.statSync(full).mtimeMs;
        } catch {
          /* ignore */
        }
        const score = ent.name.toLowerCase() === "index.html" ? 2 : 1;
        candidates.push({ p: full, mtime, score });
      }
    };
    walk(root, 0);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
    return candidates[0]!.p;
  } catch {
    return null;
  }
}

export interface PendingApproval {
  id: string;
  taskId: string;
  attemptId: string | null;
  toolRequest: Extract<NormalizedEngineEvent, { type: "tool_request" }>;
  resolve: (decision: "approve" | "reject") => void;
}

export class TaskRunner {
  private running = new Map<string, Promise<void>>();
  private stopping = false;
  private pending = new Map<string, PendingApproval>();
  /** Engine instance that owns each in-flight child process (survives hot-reload). */
  private enginesByTask = new Map<string, EngineAdapter>();
  /** Explicit run context (preamble) per task — no engine monkey-patch. */
  private runContexts = new Map<string, RunContext>();
  /** Active run attempt id per task for lease/receipt correlation. */
  private attemptByTask = new Map<string, string>();
  /** Engine-owned browser requests awaiting an exact correlated result. */
  private engineBrowserCallsByTask = new Map<
    string,
    Map<string, EngineOwnedBrowserCall>
  >();
  /** A confirmed successful engine-owned browser_open occurred this run. */
  private confirmedBrowserOpenTasks = new Set<string>();
  private maxConcurrent: number;
  private hostBridge: HostBridge;
  private runAttempts: RunAttemptService | null;
  private runAttemptLeaseMs: number;
  private runAttemptHeartbeatMs: number;
  private operationReceipts: OperationReceiptService | null;
  private declaredArtifacts: DeclaredArtifactService | null;
  /** Registry-backed preflight (Phase 3). Preferred over engine executesOwnTools only. */
  private providerPreflight: ProviderPreflightFn | null;
  private isTaskReady: (task: Task) => boolean;
  /** Optional provider for machine-level desktop settings (from SettingsService). */
  private desktopMachineProvider:
    | (() => import("@grokdesk/shared").DesktopMachineSettings)
    | null = null;
  /**
   * T4: when true, isolateGrokHome is false (inherit user plugins/hooks).
   * Default isolated when provider is null.
   */
  private inheritUserGrokProvider: (() => boolean) | null = null;
  /** T5: trusted workspace folders for project tools at run start. */
  private trustedFoldersProvider: (() => string[]) | null = null;
  /** In-memory per-thread desktop grants (survive task restarts in-process). */
  private desktopGrants = new DesktopGrantStore();
  /**
   * Optional Grok admission guard. When lease is expired, queued work becomes
   * `blocked` (recoverable) and does not spin in pumpQueue.
   */
  private entitlementGuard: EntitlementGuard | null = null;
  /** Fired when a run leaves the in-flight map (kick outbox drain, etc.). */
  private onRunSettled: (() => void) | null = null;
  /** Persist the terminal assistant response before publishing done status. */
  private reconcileAssistantTurn: ((taskId: string) => void) | null = null;

  constructor(
    private tasks: TaskService,
    private audit: AuditService,
    private engine: EngineAdapter,
    opts?: {
      maxConcurrent?: number;
      hostBridge?: HostBridge;
      desktopMachineProvider?: () => import("@grokdesk/shared").DesktopMachineSettings;
      /** T4 product path: true → inherit user Grok profile for runs. */
      inheritUserGrokProvider?: () => boolean;
      /** T5: trusted folders list for project tool gate. */
      trustedFoldersProvider?: () => string[];
      runAttempts?: RunAttemptService;
      operationReceipts?: OperationReceiptService;
      declaredArtifacts?: DeclaredArtifactService;
      providerPreflight?: ProviderPreflightFn;
      isTaskReady?: (task: Task) => boolean;
      runAttemptLeaseMs?: number;
      runAttemptHeartbeatMs?: number;
      entitlementGuard?: EntitlementGuard | null;
      /** After a run settles — e.g. schedule outbox drain. */
      onRunSettled?: () => void;
      reconcileAssistantTurn?: (taskId: string) => void;
    },
  ) {
    this.maxConcurrent = clampMaxConcurrent(opts?.maxConcurrent ?? 3);
    this.onRunSettled = opts?.onRunSettled ?? null;
    this.reconcileAssistantTurn = opts?.reconcileAssistantTurn ?? null;
    this.hostBridge = opts?.hostBridge ?? new NullHostBridge();
    this.desktopMachineProvider = opts?.desktopMachineProvider ?? null;
    this.inheritUserGrokProvider = opts?.inheritUserGrokProvider ?? null;
    this.trustedFoldersProvider = opts?.trustedFoldersProvider ?? null;
    this.runAttempts = opts?.runAttempts ?? null;
    this.runAttemptLeaseMs = Math.max(
      75,
      opts?.runAttemptLeaseMs ?? RUN_ATTEMPT_LEASE_MS,
    );
    this.runAttemptHeartbeatMs = Math.max(
      25,
      opts?.runAttemptHeartbeatMs ?? Math.floor(this.runAttemptLeaseMs / 3),
    );
    this.operationReceipts = opts?.operationReceipts ?? null;
    this.declaredArtifacts = opts?.declaredArtifacts ?? null;
    this.providerPreflight = opts?.providerPreflight ?? null;
    this.isTaskReady = opts?.isTaskReady ?? (() => true);
    this.entitlementGuard = opts?.entitlementGuard ?? null;
  }

  /** Inject or clear the shared entitlement guard (composition root / tests). */
  setEntitlementGuard(guard: EntitlementGuard | null): void {
    this.entitlementGuard = guard;
  }

  /**
   * Mark a queued task as entitlement-blocked without claiming a run attempt.
   * Status leaves `queued` so pumpQueue will not re-select it until recovery
   * requeues the work.
   */
  private blockTaskForEntitlement(
    taskId: string,
    state: DesktopLicenseState,
    action: string,
  ): void {
    const blocked = this.tasks.transitionStatus(taskId, ["queued"], "blocked");
    if (!blocked) return;
    this.tasks.appendEvent(taskId, "error", {
      message: "Entitlement is read-only for this operation",
      code: "entitlement_read_only",
      state,
      action,
      capability: "grok_operation",
    });
  }

  setProviderPreflight(fn: ProviderPreflightFn | null): void {
    this.providerPreflight = fn;
  }

  /** Attach immutable run context before pump (replaces preamble monkey-patch). */
  setRunContext(ctx: RunContext): void {
    this.runContexts.set(ctx.taskId, ctx);
  }

  takeRunContext(taskId: string): RunContext | undefined {
    const ctx = this.runContexts.get(taskId);
    return ctx;
  }

  setRunAttemptService(svc: RunAttemptService | null): void {
    this.runAttempts = svc;
  }

  setOperationReceiptService(svc: OperationReceiptService | null): void {
    this.operationReceipts = svc;
  }

  setHostBridge(bridge: HostBridge): void {
    this.hostBridge = bridge;
  }

  setDesktopMachineProvider(
    fn: () => import("@grokdesk/shared").DesktopMachineSettings,
  ): void {
    this.desktopMachineProvider = fn;
  }

  /** T4: wire Settings inheritUserGrok → engine isolateGrokHome. */
  setInheritUserGrokProvider(fn: (() => boolean) | null): void {
    this.inheritUserGrokProvider = fn;
  }

  /** T5: wire Settings trustedFolders → engine project-tool gate. */
  setTrustedFoldersProvider(fn: (() => string[]) | null): void {
    this.trustedFoldersProvider = fn;
  }

  /** Persist task grant for chat-root session id. */
  setDesktopGrant(
    taskId: string,
    granted: boolean,
    displayId?: string | null,
  ): void {
    const root = this.tasks.threadRootId(taskId);
    this.desktopGrants.set(root, granted, displayId);
  }

  getDesktopGrant(taskId: string): {
    granted: boolean;
    displayId: string | null;
  } {
    const root = this.tasks.threadRootId(taskId);
    return this.desktopGrants.get(root);
  }

  /** Drop in-memory grant when a chat thread is deleted. */
  clearDesktopGrant(taskId: string): void {
    const root = this.tasks.threadRootId(taskId);
    this.desktopGrants.delete(root);
  }

  /** Hot-swap engine (MCP/skills settings changed). In-flight tasks keep the old process. */
  setEngine(engine: EngineAdapter): void {
    this.engine = engine;
  }

  async interject(
    taskId: string,
    text: string,
    clientMutationId?: string,
  ): Promise<boolean> {
    const eng = resolveRunEngine(this.enginesByTask, taskId, this.engine);
    if (!eng.interject) return false;
    return eng.interject(taskId, text, clientMutationId);
  }

  async compact(taskId: string): Promise<boolean> {
    const eng = resolveRunEngine(this.enginesByTask, taskId, this.engine);
    if (!eng.compact) return false;
    return eng.compact(taskId);
  }

  async rewindPoints(taskId: string): Promise<Array<{
    id: string;
    label?: string;
    files?: string[];
    hasFileChanges?: boolean;
  }> | null> {
    const eng = resolveRunEngine(this.enginesByTask, taskId, this.engine);
    if (!eng.rewindPoints) return null;
    return eng.rewindPoints(taskId);
  }

  /**
   * ACP rewind: call provider, then mark `turnId` and every later turn in the
   * thread as rewound (superseded in the conversation projector).
   */
  async rewindTo(
    taskId: string,
    pointId: string,
    turnId?: string,
  ): Promise<boolean> {
    const eng = resolveRunEngine(this.enginesByTask, taskId, this.engine);
    if (!eng.rewindTo) return false;
    const ok = await eng.rewindTo(taskId, pointId);
    if (!ok) return false;

    const targetId = turnId?.trim() || taskId;
    const thread = this.tasks.collectThread(taskId);
    const ordered = [...thread].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    let startIdx = ordered.findIndex((t) => t.id === targetId);
    if (startIdx < 0) {
      // Fall back to the task that initiated the rewind RPC.
      startIdx = ordered.findIndex((t) => t.id === taskId);
    }
    if (startIdx < 0) {
      this.tasks.markRewound(targetId, {
        pointId,
        message: "Rewound to before this message",
      });
      return true;
    }
    for (const t of ordered.slice(startIdx)) {
      this.tasks.markRewound(t.id, {
        pointId,
        message: "Rewound to before this message",
      });
    }
    return true;
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = clampMaxConcurrent(n, this.maxConcurrent);
  }

  getPendingApprovals(taskId?: string): PendingApproval[] {
    return filterPendingApprovals(this.pending.values(), taskId);
  }

  /** Number of tasks currently executing (for tests / tray). */
  get runningCount(): number {
    return this.running.size;
  }

  async approve(
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<void> {
    const p = this.pending.get(approvalId);
    if (!p) return;

    let resumed = false;
    if (p.attemptId && this.runAttempts) {
      resumed = this.runAttempts.transitionOwnedAtomically(
        p.attemptId,
        "waiting_approval",
        "running",
        () =>
          Boolean(
            this.tasks.transitionStatus(
              p.taskId,
              ["waiting_approval"],
              "running",
              { emitHooks: false },
            ),
          ),
      );
    } else if (!this.runAttempts) {
      resumed = Boolean(
        this.tasks.transitionStatus(
          p.taskId,
          ["waiting_approval"],
          "running",
          { emitHooks: false },
        ),
      );
    }
    if (!resumed) {
      this.pending.delete(approvalId);
      this.tasks.appendEvent(
        p.taskId,
        "approval_resolved",
        cancelRejectedApprovalEvent(approvalId),
      );
      {
        const meta = p.toolRequest.meta as
          | { acpRequestId?: string }
          | undefined;
        resolveHumanPermission(
          meta?.acpRequestId ?? p.toolRequest.id,
          "deny",
        );
      }
      p.resolve("reject");
      return;
    }
    this.tasks.emitTaskStatusChanged(p.taskId, "running");
    this.pending.delete(approvalId);

    // Resolve host/provider approval only after the durable owner fence wins.
    try {
      await this.hostBridge.browserResolveApproval(approvalId, decision);
    } catch {
      // ignore if host has no such pending
    }
    this.audit.append({
      taskId: p.taskId,
      action: "approval",
      detail: approvalAuditDetail(approvalId, decision, p.toolRequest),
      decision,
    });
    {
      const meta = p.toolRequest.meta as
        | { acpRequestId?: string; planReview?: boolean }
        | undefined;
      const resolved = approvalResolvedEvent(approvalId, decision);
      if (meta?.planReview) {
        resolved.planReview = true;
        resolved.kind = "plan_review";
      }
      this.tasks.appendEvent(p.taskId, "approval_resolved", resolved);
    }
    if (decision === "approve") {
      const tool = p.toolRequest.tool;
      const url = browserOpenUrlFromToolMeta(
        p.toolRequest.meta as Record<string, unknown> | undefined,
      );
      if (shouldRememberBrowserOrigin(tool, url)) {
        try {
          await this.hostBridge.browserRememberOrigin(p.taskId, url);
        } catch {
          // ignore
        }
      }
    }
    // Unblock ACP session/request_permission / exit_plan_mode waiters.
    {
      const meta = p.toolRequest.meta as
        | { acpRequestId?: string }
        | undefined;
      const acpId = meta?.acpRequestId ?? p.toolRequest.id;
      resolveHumanPermission(
        acpId,
        decision === "approve" ? "allow" : "deny",
      );
    }
    p.resolve(decision);
  }

  async cancel(taskId: string): Promise<void> {
    // Prefer the engine that started this run (hot-reload safe).
    const runEngine = resolveRunEngine(this.enginesByTask, taskId, this.engine);
    const task = this.tasks.get(taskId);
    let cancelled = false;
    if (task && shouldMarkCancelled(task.status)) {
      if (this.runAttempts) {
        const result = this.runAttempts.cancelTaskAtomically(taskId, () =>
          Boolean(
            this.tasks.transitionStatus(
              taskId,
              [
                "queued",
                "running",
                "waiting_approval",
                "waiting_user",
                "blocked",
              ],
              "cancelled",
              { emitHooks: false },
            ),
          ),
        );
        cancelled = result.cancelled;
        if (cancelled) {
          this.tasks.emitTaskStatusChanged(taskId, "cancelled");
        }
      } else {
        this.tasks.setStatus(taskId, "cancelled");
        cancelled = true;
      }
    }
    await runEngine.cancel(taskId);
    if (cancelled) {
      this.attemptByTask.delete(taskId);
    } else {
      const current = this.tasks.get(taskId);
      if (current?.status === "cancelled") {
        this.attemptByTask.delete(taskId);
      }
    }
    this.runContexts.delete(taskId);
    // Reject any pending approvals for this task so runTask unblocks.
    // Append approval_resolved so the event log does not end on a dangling
    // approval_required (which would resurface as a stale banner on follow-up).
    for (const id of pendingApprovalIdsForTask(this.pending, taskId)) {
      const p = this.pending.get(id);
      if (!p) continue;
      this.pending.delete(id);
      this.tasks.appendEvent(
        p.taskId,
        "approval_resolved",
        cancelRejectedApprovalEvent(id),
      );
      {
        const meta = p.toolRequest.meta as
          | { acpRequestId?: string }
          | undefined;
        const acpId = meta?.acpRequestId ?? p.toolRequest.id;
        rejectHumanPermission(acpId);
      }
      p.resolve("reject");
    }
  }

  /** Stop only work owned by this runner; never mutate shared queued/foreign work. */
  async stopLocalRuns(): Promise<void> {
    this.stopping = true;
    // Let already-scheduled runTask calls reach their synchronous lease claim
    // before snapshotting local ownership.
    await Promise.resolve();
    const taskIds = new Set([
      ...this.running.keys(),
      ...this.attemptByTask.keys(),
      ...this.enginesByTask.keys(),
    ]);
    for (const taskId of taskIds) {
      const attemptId = this.attemptByTask.get(taskId) ?? null;
      let cancelled = false;
      if (attemptId && this.runAttempts) {
        try {
          cancelled = this.runAttempts.cancelOwnedTaskAtomically(
            attemptId,
            () =>
              Boolean(
                this.tasks.transitionStatus(
                  taskId,
                  [
                    "running",
                    "waiting_approval",
                    "waiting_user",
                    "blocked",
                  ],
                  "cancelled",
                  { emitHooks: false },
                ),
              ),
          );
        } catch {
          // Ownership may have changed or the database may be closing.
        }
      } else if (!this.runAttempts) {
        cancelled = Boolean(
          this.tasks.transitionStatus(
            taskId,
            ["running", "waiting_approval", "waiting_user", "blocked"],
            "cancelled",
            { emitHooks: false },
          ),
        );
      }
      if (cancelled) this.tasks.emitTaskStatusChanged(taskId, "cancelled");

      for (const id of pendingApprovalIdsForTask(this.pending, taskId)) {
        const pending = this.pending.get(id);
        if (!pending) continue;
        this.pending.delete(id);
        try {
          this.tasks.appendEvent(
            pending.taskId,
            "approval_resolved",
            cancelRejectedApprovalEvent(id),
          );
        } catch {
          // Best effort during teardown; always release the local promise.
        }
        {
          const meta = pending.toolRequest.meta as
            | { acpRequestId?: string }
            | undefined;
          const acpId = meta?.acpRequestId ?? pending.toolRequest.id;
          rejectHumanPermission(acpId);
        }
        pending.resolve("reject");
      }

      const runEngine = resolveRunEngine(
        this.enginesByTask,
        taskId,
        this.engine,
      );
      await runEngine.cancel(taskId).catch(() => {});
    }
    await Promise.allSettled([...this.running.values()]);
  }

  /**
   * Start a queued task and await its completion.
   * If the task is already running, awaits that run (no double-start).
   * No-ops if paused, at concurrency cap, missing, or not queued.
   */
  async start(taskId: string): Promise<void> {
    if (this.stopping) return;
    const existing = this.running.get(taskId);
    if (existing) {
      await existing;
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!this.isTaskReady(task)) return;
    const conversationBusy = this.isConversationBusy(task, taskId);
    if (
      shouldSkipStart({
        paused: this.tasks.isPaused(),
        alreadyRunning: false,
        atCapacity: this.running.size >= this.maxConcurrent,
        status: task.status,
        conversationBusy,
      })
    ) {
      return;
    }

    const promise = this.runTask(taskId).finally(() => {
      this.running.delete(taskId);
      void this.pumpQueue();
      try {
        this.onRunSettled?.();
      } catch {
        /* never break runner */
      }
    });
    this.running.set(taskId, promise);
    await promise;
  }

  /**
   * Start as many queued tasks as concurrency allows.
   * Awaits the batch of starts it kicks off (each start awaits full completion).
   */
  async pumpQueue(): Promise<void> {
    if (this.stopping || this.tasks.isPaused()) return;

    const resolveParent = (id: string): ThreadTaskLike | null => {
      const t = this.tasks.get(id);
      if (!t) return null;
      return {
        id: t.id,
        conversationId: t.conversationId ?? null,
        parentTaskId: t.parentTaskId,
      };
    };
    const ids = selectQueuedStarts({
      queued: this.tasks
        .list()
        .filter((t) => t.status === "queued" && this.isTaskReady(t))
        .map((t) => ({
          id: t.id,
          status: t.status,
          conversationId: t.conversationId ?? null,
          parentTaskId: t.parentTaskId,
        })),
      runningIds: this.running.keys(),
      maxConcurrent: this.maxConcurrent,
      resolveParent,
      resolveTask: resolveParent,
    });
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => this.start(id)));
  }

  /** True when another in-flight run shares this task's conversation/thread. */
  private isConversationBusy(task: Task, selfId: string): boolean {
    const key = threadKeyForTask(
      {
        id: task.id,
        conversationId: task.conversationId ?? null,
        parentTaskId: task.parentTaskId,
      },
      (id) => {
        const t = this.tasks.get(id);
        return t
          ? {
              id: t.id,
              conversationId: t.conversationId ?? null,
              parentTaskId: t.parentTaskId,
            }
          : null;
      },
    );
    for (const runningId of this.running.keys()) {
      if (runningId === selfId) continue;
      const peer = this.tasks.get(runningId);
      if (!peer) continue;
      const peerKey = threadKeyForTask(
        {
          id: peer.id,
          conversationId: peer.conversationId ?? null,
          parentTaskId: peer.parentTaskId,
        },
        (id) => {
          const t = this.tasks.get(id);
          return t
            ? {
                id: t.id,
                conversationId: t.conversationId ?? null,
                parentTaskId: t.parentTaskId,
              }
            : null;
        },
      );
      if (peerKey === key) return true;
    }
    return false;
  }

  private async runTask(taskId: string): Promise<void> {
    if (this.stopping) return;
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Entitlement admission after void delay, before any side effects / claim.
    // Expired lease → recoverable `blocked` (not queued) so pumpQueue cannot spin.
    // Production fail-closed: null guard still denies when FAIL_CLOSED=1.
    try {
      await requireGrokAdmission(this.entitlementGuard, "queued_execution");
    } catch (e) {
      if (isEntitlementReadOnlyError(e)) {
        const err = e as EntitlementReadOnlyError;
        this.blockTaskForEntitlement(taskId, err.state, err.action);
        return;
      }
      throw e;
    }

    // The durable run-attempt lease is the execution gate across gateway
    // processes. No status mutation, host configuration, or engine side
    // effect may occur until this instance owns the claim.
    let attemptId: string | null = null;
    if (this.runAttempts) {
      let latest = this.runAttempts.latestForTask(taskId);
      if (!latest || this.runAttempts.isTerminal(latest.status)) {
        latest = this.runAttempts.create(taskId);
      }
      const claimed = this.runAttempts.claimForTaskAtomically(
        taskId,
        this.runAttemptLeaseMs,
        () =>
          Boolean(
            this.tasks.transitionStatus(taskId, ["queued"], "running", {
              emitHooks: false,
            }),
          ),
      );
      attemptId = resolveAttemptIdForStart({
        latest,
        claimed,
        isTerminal: (s) => this.runAttempts!.isTerminal(s as never),
      });
      if (!attemptId) return;
      this.attemptByTask.set(taskId, attemptId);
      this.tasks.emitTaskStatusChanged(taskId, "running");
    }

    // Pin engine for this run so cancel works after setEngine hot-reload.
    const runEngine = this.engine;
    const { browserSessionId, desktopSessionId } = hostSessionIdsFromThreadRoot(
      this.tasks.threadRootId(taskId),
    );
    let leaseLost = false;
    let keepBrowserSession = false;
    const loseLease = () => {
      if (leaseLost) return;
      leaseLost = true;
      for (const id of pendingApprovalIdsForTask(this.pending, taskId)) {
        const pending = this.pending.get(id);
        if (!pending) continue;
        this.pending.delete(id);
        try {
          this.tasks.appendEvent(
            pending.taskId,
            "approval_resolved",
            cancelRejectedApprovalEvent(id),
          );
        } catch {
          // DB may be closing; still unblock the local engine wait below.
        }
        {
          const meta = pending.toolRequest.meta as
            | { acpRequestId?: string }
            | undefined;
          const acpId = meta?.acpRequestId ?? pending.toolRequest.id;
          rejectHumanPermission(acpId);
        }
        pending.resolve("reject");
      }
      void runEngine.cancel(taskId).catch(() => {});
    };
    const renewLease = (): boolean => {
      if (!attemptId || !this.runAttempts) return true;
      if (leaseLost) return false;
      const current = this.tasks.get(taskId);
      if (!current || current.status === "cancelled") {
        loseLease();
        return false;
      }
      let owned = false;
      try {
        owned = this.runAttempts.heartbeat(attemptId, this.runAttemptLeaseMs);
      } catch {
        loseLease();
        return false;
      }
      if (!owned) loseLease();
      return owned;
    };
    const leaseHeartbeat =
      attemptId && this.runAttempts
        ? setInterval(() => {
            renewLease();
          }, this.runAttemptHeartbeatMs)
        : null;
    leaseHeartbeat?.unref?.();
    try {
      if (!renewLease()) return;
      const completeOwnedTask = (
        taskStatus: "done" | "failed" | "cancelled",
        attemptStatus: "done" | "failed" | "cancelled" | "interrupted",
        reason: string,
      ): boolean => {
        if (!attemptId || !this.runAttempts) {
          if (taskStatus === "done") this.reconcileAssistantTurn?.(taskId);
          this.tasks.setStatus(taskId, taskStatus);
          return true;
        }
        const completed = this.runAttempts.completeOwnedAtomically(
          attemptId,
          attemptStatus,
          reason,
          () => {
            if (taskStatus === "done") this.reconcileAssistantTurn?.(taskId);
            this.tasks.setStatus(taskId, taskStatus, { emitHooks: false });
          },
        );
        if (completed) this.tasks.emitTaskStatusChanged(taskId, taskStatus);
        return completed;
      };
      if (!this.runAttempts) this.tasks.setStatus(taskId, "running");
      this.enginesByTask.set(taskId, runEngine);
      const runCtx = this.runContexts.get(taskId);
      const systemPreamble = systemPreambleFromContext(runCtx);
      const correlationRequestId = requestIdFromContext(runCtx);

      // Register task policy on the host so desk-browser MCP /exec uses the same gate.
      try {
        await this.hostBridge.browserConfigure({
          taskId: browserSessionId,
          policy: task.policySnapshot,
        });
      } catch {
        // NullHostBridge / tests without host
      }
      if (!renewLease()) return;

      // Desktop computer-use: re-apply machine settings + preserved grant for this chat root.
      try {
        const machine = this.desktopMachineProvider
          ? this.desktopMachineProvider()
          : defaultDesktopMachineSettings();
        const prior = this.desktopGrants.get(desktopSessionId);
        await this.hostBridge.desktopConfigure(
          desktopConfigureInput({
            desktopSessionId,
            granted: prior.granted,
            displayId: prior.displayId,
            machine,
          }),
        );
      } catch {
        // NullHostBridge / tests without host
      }
      if (!renewLease()) return;

      // SEC-01 / GROK-02: prefer registry-backed preflight; fall back to engine flag.
      if (this.providerPreflight) {
        const pre = await this.providerPreflight(task);
        if (!renewLease()) return;
        const plan = planFromProviderPreflight(pre);
        if (plan.kind === "reject") {
          this.tasks.appendEvent(taskId, "error", {
            message: plan.errorMessage,
          });
          const receipt = providerPreflightRejectReceipt(plan.errorMessage);
          this.operationReceipts?.append({
            taskId,
            runAttemptId: attemptId,
            action: receipt.action,
            decision: receipt.decision,
            effect: receipt.effect,
            correlationId: correlationRequestId,
            detail: receipt.detail,
          });
          if (
            !completeOwnedTask(
              plan.terminalStatus,
              "failed",
              plan.attemptReason,
            )
          )
            return;
          return;
        }
        if (plan.kind === "degraded") {
          this.tasks.appendEvent(taskId, "step", {
            title: plan.stepTitle,
            status: "start",
          });
          const receipt = providerPreflightDegradedReceipt(plan.stepTitle);
          this.operationReceipts?.append({
            taskId,
            runAttemptId: attemptId,
            action: receipt.action,
            decision: receipt.decision,
            effect: receipt.effect,
            correlationId: correlationRequestId,
            detail: receipt.detail,
          });
        }
      } else {
        if (!renewLease()) return;
        const gate = evaluateProviderOwnToolsGate({
          executesOwnTools: runEngine.executesOwnTools,
          allowShell: task.policySnapshot.allowShell,
          allowNetworkTools: task.policySnapshot.allowNetworkTools,
          approvalMode: task.policySnapshot.approvalMode,
        });
        const plan = planFromEngineOwnToolsGate(gate);
        if (plan.kind === "reject" && gate.action === "reject") {
          if (!renewLease()) return;
          this.tasks.appendEvent(taskId, "error", {
            message: plan.errorMessage,
          });
          this.operationReceipts?.append({
            taskId,
            runAttemptId: attemptId,
            action: gate.receipt.action,
            decision: gate.receipt.decision,
            effect: gate.receipt.effect,
            correlationId: correlationRequestId,
            detail: gate.receipt.detail,
          });
          if (
            !completeOwnedTask(
              plan.terminalStatus,
              "failed",
              plan.attemptReason,
            )
          )
            return;
          return;
        }
        if (plan.kind === "degraded" && gate.action === "degraded") {
          this.tasks.appendEvent(taskId, "step", {
            title: plan.stepTitle,
            status: "start",
          });
          this.operationReceipts?.append({
            taskId,
            runAttemptId: attemptId,
            action: gate.receipt.action,
            decision: gate.receipt.decision,
            effect: gate.receipt.effect,
            correlationId: correlationRequestId,
            detail: gate.receipt.detail,
          });
        }
      }

      this.engineBrowserCallsByTask.set(taskId, new Map());
      this.confirmedBrowserOpenTasks.delete(taskId);
      let sawError = false;
      try {
        const priorProviderSessionId =
          this.runAttempts?.latestProviderSessionId(taskId) ??
          (task.parentTaskId
            ? this.runAttempts?.latestProviderSessionId(task.parentTaskId) ??
              this.tasks.getProviderSessionId(task.parentTaskId)
            : null) ??
          this.tasks.getProviderSessionId(taskId) ??
          undefined;
        // T4: Settings inheritUserGrok (default false) → isolate unless true.
        // Env GROKDESK_INHERIT_USER_GROK=1 remains a debug override in the engine
        // when isolateGrokHome is left undefined; we always pass an explicit value.
        const inheritUserGrok = Boolean(this.inheritUserGrokProvider?.());
        const trustedFolders = this.trustedFoldersProvider?.() ?? [];
        // I7: wall + idle budgets on the product runner path (headless + ACP).
        const budgetLimits = runBudgetLimitsFromEnv(process.env);
        let budgetState: RunBudgetState = createRunBudgetState(
          Date.now(),
          budgetLimits,
        );
        const budgetTimer = setInterval(() => {
          const check = checkRunBudget(budgetState, Date.now());
          if (!check.ok) {
            // I7: silent idle/wall must still emit terminal reason codes
            // (no onEvent path when the engine is hung without progress).
            this.tasks.appendEvent(taskId, "error", {
              message: check.message,
              code: check.code,
            });
            sawError = true;
            void runEngine.cancel(taskId).catch(() => {});
          }
        }, 5_000);
        budgetTimer.unref?.();
        try {
          await runEngine.run({
            task,
            systemPreamble,
            browserSessionId,
            priorProviderSessionId,
            planFirst: task.planFirst === true,
            isolateGrokHome: !inheritUserGrok,
            trustedFolders,
            onEvent: async (event) => {
              if (leaseLost) return "abort";
              const current = this.tasks.get(taskId);
              if (!current || current.status === "cancelled") {
                return "abort";
              }
              if (this.tasks.isPaused()) {
                return "abort";
              }
              if (event.type === "error") {
                sawError = true;
              }
              // Activity for idle budget: any engine event (incl. run_progress heartbeats).
              budgetState = touchRunBudgetActivity(budgetState, Date.now());
              const budget = checkRunBudget(budgetState, Date.now());
              if (!budget.ok) {
                this.tasks.appendEvent(taskId, "error", {
                  message: budget.message,
                  code: budget.code,
                });
                sawError = true;
                void runEngine.cancel(taskId).catch(() => {});
                return "abort";
              }
              // Keep lease alive during long runs.
              if (!renewLease()) return "abort";
              return this.handleEvent(
                taskId,
                event,
                browserSessionId,
                attemptId,
                runEngine.executesOwnTools,
              );
            },
          });
        } finally {
          clearInterval(budgetTimer);
        }
        if (!renewLease()) return;

        const current = this.tasks.get(taskId);
        const exitPlan = planPostEngineExit({
          status: current?.status,
          sawError,
        });
        if (exitPlan.kind === "failed_waiting") {
          // Engine process ended while parked on approval — not success.
          this.tasks.appendEvent(taskId, "error", {
            message: exitPlan.errorMessage,
          });
          if (
            !completeOwnedTask(
              "failed",
              exitPlan.attemptStatus,
              exitPlan.attemptReason,
            )
          )
            return;
        } else if (exitPlan.kind === "complete_running") {
          // Grok Build executes tools itself — no artifact events unless we harvest.
          // AWAIT open so we do not race browserDestroy in finally (was dropping pane).
          keepBrowserSession = this.confirmedBrowserOpenTasks.has(taskId);
          if (exitPlan.harvest && !keepBrowserSession) {
            keepBrowserSession =
              await this.harvestWorkspaceDeliverables(taskId);
          }
          if (
            leaseLost ||
            !completeOwnedTask(
              exitPlan.status,
              exitPlan.status,
              exitPlan.attemptReason,
            )
          )
            return;
          // Only keep the agent browser when this run actually used it (harvest
          // open or browser_* tools). Keeping it after every "done" left empty
          // WebContentsViews attached and floating over the next chat.
        }
        // kind === "noop": cancelled / missing / already terminal
      } catch (err) {
        try {
          if (leaseLost) return;
          if (!renewLease()) return;
          const current = this.tasks.get(taskId);
          if (current?.status === "cancelled") return;
          const message = errorMessageFromUnknown(err);
          this.tasks.appendEvent(taskId, "error", { message });
          if (!completeOwnedTask("failed", "failed", message)) return;
        } catch {
          // DB closed during shutdown/tests — ignore
        }
      }
    } finally {
      if (leaseHeartbeat) clearInterval(leaseHeartbeat);
      this.enginesByTask.delete(taskId);
      this.attemptByTask.delete(taskId);
      this.runContexts.delete(taskId);
      // Browser pane: keep chat-root view while siblings are active, after a
      // successful open, or after a done run (user is looking at the result).
      // Desktop control host state must NOT stay granted after the run ends —
      // otherwise desk-desktop MCP can still inject input while idle. Grants in
      // DesktopGrantStore are re-applied on the next run start. Chat delete also
      // destroys both planes.
      try {
        const activeSiblings = this.threadHasActiveBrowserUsers(
          browserSessionId,
          taskId,
        );
        const confirmedDirectOpen = this.confirmedBrowserOpenTasks.has(taskId);
        if (!activeSiblings && !keepBrowserSession && !confirmedDirectOpen) {
          await this.hostBridge.browserDestroy(browserSessionId);
        }
        // Always tear down desktop host grants when this chat root is idle.
        if (!activeSiblings) {
          await this.hostBridge.desktopDestroy(desktopSessionId);
        }
      } catch {
        // host or DB unavailable (tests / shutdown)
      } finally {
        this.engineBrowserCallsByTask.delete(taskId);
        this.confirmedBrowserOpenTasks.delete(taskId);
      }
    }
  }

  /** True if another non-terminal task still uses this chat-root browser session. */
  private threadHasActiveBrowserUsers(
    browserSessionId: string,
    excludingTaskId: string,
  ): boolean {
    try {
      return threadHasActiveBrowserUsersPure(
        this.tasks.collectThread(browserSessionId),
        excludingTaskId,
      );
    } catch {
      // DB may already be closed (tests / shutdown) — allow destroy.
      return false;
    }
  }

  /**
   * Register files Grok wrote into the workspace as artifacts.
   * Real Grok Build does not emit formal artifact events (executesOwnTools).
   *
   * Only harvests files touched during this task (mtime ≥ createdAt) so a
   * large project folder does not re-attach every historical deliverable.
   * Primary root only — secondary project folders are read/context roots and
   * must not auto-attach pre-existing files as task artifacts.
   *
   * @returns true when the in-app browser was opened with HTML (keep pane).
   */
  async harvestWorkspaceDeliverables(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const events = this.tasks.listEvents(taskId);
    const knownPaths = knownArtifactPathsFromEvents(events, (p) =>
      path.resolve(p),
    );

    // 30s slack for clock skew / writes started just before status=running.
    const sinceMs = harvestSinceMs(task.createdAt);
    const roots = (task.policySnapshot.workspaceRoots ?? []).filter(Boolean);
    if (roots.length === 0) return false;

    // Primary (index 0) is the managed/task workspace; additional roots are
    // user project folders for context, not harvest sources.
    const primaryRoot = roots[0]!;
    const allFiles: ReturnType<typeof listDeliverableFiles>["files"] = [];
    let skipTotal = 0;
    {
      const { files, skipped } = listDeliverableFiles(primaryRoot, 40, sinceMs);
      allFiles.push(...files);
      skipTotal += skipped.oversize + skipped.overflow;
    }
    // Prefer media, then newer paths (listDeliverableFiles already ranks per root).
    allFiles.sort((a, b) => {
      const am = guessArtifactKind(a.name) === "media" ? 0 : 1;
      const bm = guessArtifactKind(b.name) === "media" ? 0 : 1;
      if (am !== bm) return am - bm;
      return 0;
    });
    const toCreate = selectNewDeliverableArtifacts(allFiles.slice(0, 40), knownPaths, {
      resolvePath: (p) => path.resolve(p),
      guessKind: (name) => guessArtifactKind(name),
      guessMime: (name) => guessArtifactMime(name),
    });
    const browserSessionId = this.tasks.threadRootId(taskId);
    let htmlToOpen: string | null = null;
    let mediaCreated = 0;
    for (const item of toCreate) {
      this.tasks.appendEvent(
        taskId,
        "artifact_created",
        harvestArtifactCreatedPayload(item, randomUUID()),
      );
      if (item.kind === "media") mediaCreated += 1;
      // Auto-open HTML when the model forgot browser_open (Chrome detours, etc.).
      if (!htmlToOpen && isHtmlDeliverablePath(item.path)) {
        htmlToOpen = item.path;
      }
    }
    // ASSET-4: surface silent caps once so oversized/overflow files aren't invisible.
    if (skipTotal > 0) {
      this.tasks.appendEvent(taskId, "step", {
        title: `Skipped ${skipTotal} file(s) — over size limit or file cap`,
        status: "end",
      });
    }
    // Image goals that finish with zero media: say so (don't leave "generating…" as success).
    if (
      mediaCreated === 0 &&
      /\b(image|hero|logo|poster|visual|illustration|generate\s+an?\s+img|imagine)\b/i.test(
        task.goal ?? "",
      )
    ) {
      this.tasks.appendEvent(taskId, "message", {
        role: "assistant",
        text:
          "No new image file was found in the workspace after this run. " +
          "If generation failed or was skipped, try again — or check that SuperGrok image tools are available for your account.",
        channel: "text",
      });
    }
    // Always try existing workspace HTML when none was created this turn
    // (e.g. "open the panda site in the browser").
    const primary = roots[0]!;
    if (!htmlToOpen) {
      htmlToOpen = findBestHtmlInWorkspace(primary);
    }
    // Prefer open when the user goal is about viewing in the browser.
    const goalWantsBrowser = /\b(browser|open|preview|show)\b/i.test(
      task.goal ?? "",
    );
    if (htmlToOpen && (goalWantsBrowser || toCreate.length > 0)) {
      return (
        await this.openHtmlInAgentBrowser(
          browserSessionId,
          htmlToOpen,
          taskId,
          "agent",
        )
      ).ok;
    }
    // Still open HTML deliverables produced this turn even if goal wording is vague.
    if (htmlToOpen && toCreate.some((i) => isHtmlDeliverablePath(i.path))) {
      return (
        await this.openHtmlInAgentBrowser(
          browserSessionId,
          htmlToOpen,
          taskId,
          "agent",
        )
      ).ok;
    }
    return false;
  }

  /**
   * User/one-click path: open a local HTML deliverable in the agent browser
   * for the chat root of `taskId`. Does not require the model to call tools.
   */
  async openLocalHtml(
    taskId: string,
    htmlPath: string,
  ): Promise<{ ok: boolean; output: string }> {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, output: "task not found" };
    const browserSessionId = this.tasks.threadRootId(taskId);
    return this.openHtmlInAgentBrowser(
      browserSessionId,
      htmlPath,
      taskId,
      "renderer_user",
    );
  }

  /** Open a safe web link in the browser partition owned by this chat. */
  async openUrlInAgentBrowser(
    taskId: string,
    rawUrl: string,
  ): Promise<{ ok: boolean; output: string }> {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, output: "task not found" };
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, output: "invalid URL" };
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return { ok: false, output: "only credential-free HTTP(S) links are allowed" };
    }
    return this.openBrowserTarget(
      this.tasks.threadRootId(taskId),
      { url: url.toString() },
      taskId,
      "renderer_user",
    );
  }

  /**
   * Load a local HTML page into the desk agent browser and record tool events
   * so the UI auto-opens the globe pane only after a successful host receipt.
   */
  private async openHtmlInAgentBrowser(
    browserSessionId: string,
    htmlPath: string,
    eventTaskId: string,
    source: "renderer_user" | "agent",
  ): Promise<{ ok: boolean; output: string }> {
    return this.openBrowserTarget(
      browserSessionId,
      { path: htmlPath, url: htmlPath },
      eventTaskId,
      source,
    );
  }

  private async openBrowserTarget(
    browserSessionId: string,
    target: { path?: string; url: string },
    eventTaskId: string,
    source: "renderer_user" | "agent",
  ): Promise<{ ok: boolean; output: string }> {
    const requestId = randomUUID();
    // Emit intent before host I/O so work detail remains truthful if exec
    // hangs or throws. The pane itself waits for host status or a success.
    try {
      this.tasks.appendEvent(eventTaskId, "tool_request", {
        id: requestId,
        tool: "browser_open",
        meta: target,
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.hostBridge.browserConfigure({
        taskId: browserSessionId,
        policy: this.tasks.get(eventTaskId)?.policySnapshot ?? {
          approvalMode: "strict",
          workspaceRoots: [],
          allowNetworkTools: false,
          allowShell: false,
        },
      });
      // Prefer absolute filesystem path (not file://) — avoids null-origin approval.
      const result = await this.hostBridge.browserExec({
        taskId: browserSessionId,
        tool: "browser_open",
        args: target,
        source,
      });
      this.tasks.appendEvent(eventTaskId, "tool_result", {
        id: requestId,
        tool: "browser_open",
        ok: result.ok,
        output: result.output?.slice(0, 500) ?? "",
        ...(result.ok ? { browserProvider: "desk-browser" } : {}),
      });
      return {
        ok: Boolean(result.ok),
        output:
          result.output ||
          (result.ok ? "opened in browser" : "browser open failed"),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        this.tasks.appendEvent(eventTaskId, "tool_result", {
          id: requestId,
          tool: "browser_open",
          ok: false,
          output: msg.slice(0, 500),
        });
      } catch {
        /* non-fatal */
      }
      return { ok: false, output: msg };
    }
  }

  private async handleEvent(
    taskId: string,
    event: NormalizedEngineEvent,
    browserSessionId?: string,
    runAttemptId?: string | null,
    runEngineExecutesOwnTools = this.engine.executesOwnTools,
  ): Promise<"continue" | "abort"> {
    const task = this.tasks.get(taskId);
    if (
      shouldAbortHandleEvent({
        paused: this.tasks.isPaused(),
        task,
      })
    ) {
      return "abort";
    }
    // Narrowed by shouldAbortHandleEvent — task is present and not cancelled.
    const liveTask = task!;
    const browserId = browserSessionId ?? this.tasks.threadRootId(taskId);
    const attemptId = runAttemptId ?? this.attemptByTask.get(taskId) ?? null;

    switch (event.type) {
      case "message":
        this.tasks.appendEvent(taskId, "message", messageEventPayload(event));
        return "continue";

      case "run_progress":
        // Transient — never store as assistant transcript content.
        this.tasks.appendEvent(taskId, "step", runProgressStepPayload(event));
        return "continue";

      case "session_meta":
        // Persist for resume only — never as conversation/task transcript.
        if (attemptId && this.runAttempts && event.providerSessionId) {
          this.runAttempts.setProviderSessionId(
            attemptId,
            event.providerSessionId,
          );
        }
        // T3: store spawn protection snapshot as a non-message step so the UI
        // chip can re-project from the same argv used to launch.
        if (event.protection) {
          this.tasks.appendEvent(taskId, "step", {
            title: "protection",
            status: "start",
            protection: event.protection,
          });
        }
        if (event.capabilities) {
          this.tasks.appendEvent(taskId, "step", {
            title: "capabilities",
            status: "start",
            capabilities: event.capabilities,
          });
        }
        return "continue";

      case "usage":
        // Persist on attempt only — never as conversation transcript.
        if (attemptId && this.runAttempts) {
          this.runAttempts.setLastUsage?.(attemptId, {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            contextWindow: event.contextWindow,
          });
        }
        return "continue";

      case "plan_update":
        this.tasks.appendEvent(taskId, "plan_update", {
          content: event.content,
          status: event.status,
        });
        return "continue";

      case "citations":
        this.tasks.appendEvent(taskId, "citations", {
          items: event.items,
        });
        return "continue";

      case "step":
        this.tasks.appendEvent(taskId, "step", stepEventPayload(event));
        return "continue";

      case "tool_request": {
        this.tasks.appendEvent(
          taskId,
          "tool_request",
          toolRequestEventPayload(event),
        );

        if (isBrowserToolName(event.tool)) {
          return this.handleBrowserTool(taskId, event, browserId, attemptId);
        }

        const meta = (event.meta ?? {}) as Record<string, unknown>;
        // ACP ask / plan-review always parks in the gateway approval UI
        // (broker already decided this needs a human).
        const commandCwd =
          typeof event.meta?.cwd === "string"
            ? event.meta.cwd
            : liveTask.policySnapshot.workspaceRoots[0] ?? process.cwd();
        let decision = evaluateToolRequest(
          liveTask.policySnapshot,
          {
            tool: event.tool,
            path: event.path,
            command: event.command,
            meta: event.meta,
          },
          {
            shell: {
              cwd: commandCwd,
              canonicalizePath: (candidate) => {
                try {
                  return realpathSync.native(path.resolve(commandCwd, candidate));
                } catch {
                  return null;
                }
              },
            },
          },
        );
        if (meta.planReview === true || meta.acpAsk === true) {
          decision = {
            decision: "needs_approval",
            reason: meta.planReview
              ? "Plan ready for review"
              : "Tool requires approval",
          };
        }

        this.audit.append({
          taskId,
          action: "policy_check",
          detail: toolPolicyAuditDetail(event, decision),
          decision: policyDecisionToAuditDecision(decision.decision),
        });

        {
          const receipt = toolPolicyReceiptFields(event, decision);
          this.operationReceipts?.append({
            taskId,
            runAttemptId: attemptId,
            action: receipt.action,
            decision: receipt.decision,
            effect: receipt.effect,
            detail: receipt.detail,
            correlationId: receipt.correlationId,
          });
        }

        if (decision.decision === "deny") {
          this.tasks.appendEvent(
            taskId,
            "tool_result",
            toolResultDeniedPayload(event, decision.reason),
          );
          return "continue";
        }

        if (decision.decision === "needs_approval") {
          const parked = this.runAttempts
            ? attemptId
              ? this.runAttempts.transitionOwnedAtomically(
                  attemptId,
                  "running",
                  "waiting_approval",
                  () =>
                    Boolean(
                      this.tasks.transitionStatus(
                        taskId,
                        ["running"],
                        "waiting_approval",
                        { emitHooks: false },
                      ),
                    ),
                )
              : false
            : Boolean(
              this.tasks.transitionStatus(
                taskId,
                ["running"],
                "waiting_approval",
                { emitHooks: false },
              ),
            );
          if (!parked) return "abort";
          this.tasks.emitTaskStatusChanged(taskId, "waiting_approval");
          const approvalId = randomUUID();
          this.tasks.appendEvent(taskId, "approval_required", {
            approvalId,
            tool: event,
            reason: decision.reason,
            ...(meta.planReview === true
              ? {
                  planReview: true,
                  planContent: meta.planContent,
                  kind: "plan_review",
                }
              : {}),
            ...(meta.acpAsk === true ? { acpAsk: true } : {}),
          });

          const userDecision = await new Promise<"approve" | "reject">(
            (resolve) => {
              if (this.pending.size >= 64) {
                resolve("reject");
                return;
              }
              this.pending.set(approvalId, {
                id: approvalId,
                taskId,
                attemptId: attemptId ?? null,
                toolRequest: event,
                resolve,
              });
            },
          );

          // Task may have been cancelled while waiting
          const after = this.tasks.get(taskId);
          if (shouldAbortAfterApprovalWait(after)) {
            return "abort";
          }
          if (
            attemptId &&
            this.runAttempts &&
            !this.runAttempts.heartbeat(attemptId, this.runAttemptLeaseMs)
          ) {
            return "abort";
          }

          if (userDecision === "reject") {
            this.tasks.appendEvent(
              taskId,
              "tool_result",
              toolResultUserRejectedPayload(event),
            );
            const rejected = userRejectedToolReceipt(event);
            this.operationReceipts?.append({
              taskId,
              runAttemptId: attemptId,
              action: rejected.action,
              decision: rejected.decision,
              effect: rejected.effect,
              detail: rejected.detail,
              correlationId: rejected.correlationId,
            });
            return "continue";
          }
          {
            const approved = userApprovedToolReceipt(event);
            this.operationReceipts?.append({
              taskId,
              runAttemptId: attemptId,
              action: approved.action,
              decision: approved.decision,
              effect: approved.effect,
              detail: approved.detail,
              correlationId: approved.correlationId,
            });
          }
        }

        // Only execute host tools when the engine does not (TestEngine).
        // GrokBuildEngine sets executesOwnTools=true and runs tools itself.
        if (!runEngineExecutesOwnTools) {
          const payload = writeFilePayload(event);
          if (payload && event.path) {
            const absWrite = path.resolve(event.path);
            try {
              assertPathInsideWorkspaceRoots(
                absWrite,
                liveTask.policySnapshot.workspaceRoots ?? [],
              );
              await fs.mkdir(path.dirname(absWrite), { recursive: true });
              await fs.writeFile(absWrite, payload.content, "utf8");
              this.tasks.appendEvent(taskId, "tool_result", {
                id: event.id,
                ok: true,
                output: writeFileSuccessOutput(absWrite),
              });
              this.operationReceipts?.append({
                taskId,
                runAttemptId: attemptId,
                action: `tool:write_file`,
                decision: "allow",
                effect: "executed",
                detail: writeFileReceiptDetail(absWrite, payload.bytes),
                correlationId: event.id,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              this.tasks.appendEvent(taskId, "tool_result", {
                id: event.id,
                ok: false,
                output: msg.slice(0, 500),
              });
            }
          } else if (event.tool === "write_file") {
            this.tasks.appendEvent(taskId, "tool_result", {
              id: event.id,
              ok: false,
              output: "write_file content missing or too large",
            });
          }
        }

        return "continue";
      }

      case "tool_result":
        {
          const pending = this.engineBrowserCallsByTask
            .get(taskId)
            ?.get(event.id);
          if (pending) {
            this.engineBrowserCallsByTask.get(taskId)?.delete(event.id);
            const recorded = recordEngineOwnedBrowserToolResult({
              taskId,
              call: pending,
              event,
              tasks: this.tasks,
              audit: this.audit,
              operationReceipts: this.operationReceipts,
            });
            if (recorded.confirmedOpen) {
              this.confirmedBrowserOpenTasks.add(taskId);
            }
            return "continue";
          }
        }
        this.tasks.appendEvent(
          taskId,
          "tool_result",
          toolResultEventPayload(event),
        );
        return "continue";

      case "artifact": {
        const id = randomUUID();
        this.tasks.appendEvent(
          taskId,
          "artifact_created",
          artifactCreatedEventPayload(event, id),
        );
        // Prefer declared artifacts over mtime harvest alone (TASK-06).
        try {
          this.declaredArtifacts?.declare({
            taskId,
            runAttemptId: attemptId,
            title: event.title,
            path: event.path,
            kind: event.kind,
            declaredBy: "provider",
          });
        } catch {
          /* duplicate or DB issue — event still recorded */
        }
        return "continue";
      }

      case "worker_started":
      case "worker_activity":
      case "worker_message":
      case "worker_completed":
      case "worker_failed":
        this.tasks.appendEvent(taskId, event.type, workerEventPayload(event));
        return "continue";

      case "done": {
        // Skip useless lifecycle summaries — they pollute the result UI.
        const msg = doneSummaryMessagePayload(
          event.summary,
          isUsefulDoneSummary,
        );
        if (msg) {
          this.tasks.appendEvent(taskId, "message", { ...msg, terminal: true });
        }
        return "continue";
      }

      case "error":
        this.tasks.appendEvent(taskId, "error", errorEventPayload(event));
        return "abort";

      default:
        return "continue";
    }
  }

  /**
   * Register a host-parked browser approval so the stream shows the same card
   * as other tool approvals. User resolves via tasks.approve.
   */
  registerHostBrowserApproval(input: {
    approvalId: string;
    taskId: string;
    tool: string;
    reason: string;
    url?: string;
    args?: Record<string, unknown>;
  }): void {
    // input.taskId is the browser session id (chat root). Prefer a live task
    // in that thread for status + stream so the open workspace sees the card.
    const thread = this.tasks.collectThread(input.taskId);
    const eventTaskId = eventTaskIdForHostParkedApproval({
      browserSessionId: input.taskId,
      liveFromThread: resolveLiveThreadTask(thread),
      taskFromSession: this.tasks.get(input.taskId),
    });

    const toolRequest = buildHostParkedToolRequest({
      approvalId: input.approvalId,
      browserSessionId: input.taskId,
      tool: input.tool,
      reason: input.reason,
      url: input.url,
      args: input.args,
    }) as Extract<NormalizedEngineEvent, { type: "tool_request" }>;
    const attemptId = this.attemptByTask.get(eventTaskId) ?? null;
    const parked = this.runAttempts
      ? attemptId
        ? this.runAttempts.transitionOwnedAtomically(
            attemptId,
            "running",
            "waiting_approval",
            () =>
              Boolean(
                this.tasks.transitionStatus(
                  eventTaskId,
                  ["running"],
                  "waiting_approval",
                  { emitHooks: false },
                ),
              ),
          )
        : false
      : Boolean(
          this.tasks.transitionStatus(
            eventTaskId,
            ["running"],
            "waiting_approval",
            { emitHooks: false },
          ),
        );
    if (!parked) return;
    this.tasks.emitTaskStatusChanged(eventTaskId, "waiting_approval");
    this.tasks.appendEvent(
      eventTaskId,
      "approval_required",
      hostParkedApprovalRequiredPayload(
        {
          approvalId: input.approvalId,
          browserSessionId: input.taskId,
          tool: input.tool,
          reason: input.reason,
          url: input.url,
          args: input.args,
        },
        toolRequest,
      ),
    );
    if (this.pending.size < 64) {
      this.pending.set(input.approvalId, {
        id: input.approvalId,
        taskId: eventTaskId,
        attemptId,
        toolRequest,
        resolve: () => {
          // Host also receives resolve via browserResolveApproval in approve().
        },
      });
    }
  }

  private async handleBrowserTool(
    taskId: string,
    event: Extract<NormalizedEngineEvent, { type: "tool_request" }>,
    browserSessionId: string,
    attemptId?: string | null,
  ): Promise<"continue" | "abort"> {
    const runEngine = resolveRunEngine(this.enginesByTask, taskId, this.engine);
    if (runEngine.executesOwnTools) {
      const calls = this.engineBrowserCallsByTask.get(taskId) ?? new Map();
      calls.set(
        event.id,
        engineOwnedBrowserCallFromRequest({
          event,
          browserSessionId,
          runAttemptId: attemptId,
        }),
      );
      this.engineBrowserCallsByTask.set(taskId, calls);
    }
    const outcome = await handleBrowserToolRequest({
      taskId,
      event,
      browserSessionId,
      tasks: this.tasks,
      audit: this.audit,
      hostBridge: this.hostBridge,
      engine: runEngine,
      operationReceipts: this.operationReceipts,
      runAttemptId: attemptId,
    });
    if (outcome.confirmedOpen) {
      this.confirmedBrowserOpenTasks.add(taskId);
    }
    return outcome.flow;
  }
}
