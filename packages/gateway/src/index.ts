import fs from "node:fs";
import path from "node:path";
import type {
  AuthState,
  GatewayNotifyMessage,
  GatewayNotifyMethod,
  GatewayNotifyParams,
  IpcRequest,
  Task,
  TrayStatus,
} from "@grokdesk/shared";
import { getRolePack } from "@grokdesk/shared";
import { openDatabase, type Db } from "./db.js";
import {
  prepareWorkspaceAssetMeta,
  readWorkspaceAssetDataUrl,
} from "./workspace-asset.js";
import {
  resolveDataPaths,
  resolveDataPathsFromProcess,
  type DataPaths,
  type EnvLike,
} from "./config.js";
import { TaskService } from "./services/tasks.js";
import { AuditService } from "./services/audit.js";
import { TaskRunner } from "./services/runner.js";
import { loadAttachmentsPreamble } from "./services/attachment-stage.js";
import { ArtifactService } from "./services/artifacts.js";
import { MemoryService } from "./services/memory.js";
import { SettingsService } from "./services/settings.js";
import { SchedulerService } from "./services/scheduler.js";
import { InboxService } from "./services/inbox.js";
import { ProactivityService } from "./services/proactivity.js";
import type { AppSettings } from "./services/settings.js";
import { engineSettingsChanged } from "./services/engine-settings.js";
import { applyEngineSettingsRebuild } from "./services/engine-rebuild.js";
import {
  ensureDeskPlanesEngine,
  resolveDeskPlaneMcpServers,
} from "./services/ensure-desk-planes-engine.js";
import { NullHostBridge, type HostBridge } from "./host-bridge.js";
import {
  loadRemoteConfig,
  RemoteService,
  saveRemoteConfig,
} from "./services/remote.js";
import { RemoteSessionHost } from "./services/remote-session.js";
import { TelepresenceService } from "./services/telepresence.js";
import {
  desktopRequestContext,
  type RequestContext,
} from "./services/request-context.js";
import {
  extractClientMutationId,
  IDEMPOTENT_MUTATION_METHODS,
  MutationReceiptService,
  MutationSingleFlight,
  mutationPrincipalId,
} from "./services/mutation-receipts.js";
import { RunAttemptService } from "./services/run-attempts.js";
import { ScheduleOccurrenceService } from "./services/schedule-occurrences.js";
import { TaskSubmissionService } from "./services/task-submission.js";
import { TaskCreateAcceptanceService } from "./services/task-create-acceptance.js";
import { OperationReceiptService } from "./services/operation-receipts.js";
import { ConversationService } from "./services/conversations.js";
import { reconcileAssistantTurn } from "./services/assistant-turn-reconciliation.js";
import { ConversationOutboxRepository } from "./services/conversation-outbox.js";
import { OutboxDrainCoordinator } from "./services/outbox-drain.js";
import { DeclaredArtifactService } from "./services/declared-artifacts.js";
import {
  createDefaultProviderRegistry,
  deskPolicyToEffective,
  evaluateProviderPolicyGate,
} from "./provider-composition.js";
import type { ProviderRegistry } from "@grokdesk/agent-runtime";
import { createProviderPreflight } from "./services/provider-preflight.js";
import { createAgentProviderEngine } from "./services/agent-provider-engine.js";
import { createLiveAcpTransportFactory } from "./services/acp-transport-factory.js";
import { createFileCredentialVault } from "./services/credential-vault.js";
import { resolveEngineSelection } from "./services/engine-selection.js";
import {
  PowerStateGate,
  type PowerState,
} from "./services/power-state.js";
import { DebouncedNotifyScheduler } from "./services/notify-scheduler.js";
import { deleteChatThread } from "./services/chat-deletion.js";
import { listWorkspaceFiles as listWorkspaceFilesImpl } from "./services/workspace-list.js";
import { readWorkspaceFilePreview } from "./services/workspace-read-file.js";
import { collectAllowedWorkspaceRoots } from "./services/workspace-path-confine.js";
import {
  cleanupEmptyOrphanWorkspaces,
  ensureTempWorkspace as ensureTempWorkspaceImpl,
  resolveTaskWorkspaceRoots as resolveTaskWorkspaceRootsImpl,
} from "./services/temp-workspace.js";
import { runWithMemory as runWithMemoryImpl } from "./services/run-with-memory.js";
import { standingMemoryForRolePack } from "./services/role-pack-apply.js";
import { finalizeTaskAttachments } from "./services/attachment-stage.js";
// re-export pure helpers for tests / composition
export { isManagedWorkspaceRoot } from "./services/workspace-managed.js";
import { doctorMcpServers } from "@grokdesk/shared";
import {
  dispatchRemoteMethod,
  isRemoteMethod,
} from "./services/remote-dispatch.js";
import {
  createDefaultEngine,
  getGrokAuthStatus,
  type EngineAdapter,
} from "./engine-composition.js";
import { recoverInterruptedTasks } from "./services/crash-recovery.js";
import { authSignIn, authSignOut, authStatus } from "./services/auth-grok.js";
import { autoTitleTask } from "./services/title-generation.js";
import { computeTrayStatus } from "./services/tray-status.js";
import { syncInboxFromWaitingOnYou } from "./services/waiting-on-you-inbox.js";
import { artifactCreateFromEvent } from "./services/artifact-event-persist.js";
import { dispatchDomainMethod } from "./services/domain-dispatch.js";
import { buildDomainDispatchDeps } from "./services/gateway-domain-deps.js";
import {
  buildTaskCreateFlowDeps,
  dispatchTasksCreate,
} from "./services/tasks-create-dispatch.js";
import { resumeAcceptedTaskCreate } from "./services/task-create-flow.js";
import { tryBindTaskConversation } from "./services/task-conversation-bind.js";
import { normalizeAuditDecision } from "./services/audit-decision.js";
import {
  startQueueWatchdog,
  type QueueWatchdogControl,
} from "./services/queue-watchdog.js";
import { wireEntitlementEnforcement } from "./services/entitlement-composition.js";
import type { EntitlementGuard } from "./services/entitlement-guard.js";
import { wrapEngineWithEntitlementGuard } from "./services/entitlement-engine.js";

export {
  resolveDataPaths,
  resolveDataPathsFromProcess,
  type DataPaths,
  type EnvLike,
} from "./config.js";
export { openDatabase, type Db } from "./db.js";
export {
  LEGACY_MIGRATION_SUNSET_ISO,
  LEGACY_MIGRATION_SUPPORT_URL,
  LEGACY_MIGRATION_PORTAL_URL,
  LICENSE_CANARY_PATTERNS,
  classifyLegacyKey,
  detectLegacyLicense,
  detectLegacyLicenseInDb,
  extractLegacyLicense,
  purgeLegacyLicense,
  openLegacyMigrationDb,
  fingerprintLegacyMaterial,
  isLegacyExchangeOpen,
  scanBufferForLicenseCanaries,
  scanDbFilesForLicenseCanaries,
  assertNoLicenseCanariesInDb,
  activationStateToMaterial,
  type LegacyKeyScheme,
  type LegacyLicenseMaterial,
  type LegacyDetection,
  type LegacyExtractOnce,
  type PurgeResult,
} from "./legacy-license-migration.js";
export { TaskService } from "./services/tasks.js";
export { AuditService } from "./services/audit.js";
export { TaskRunner, type PendingApproval } from "./services/runner.js";
export { ArtifactService } from "./services/artifacts.js";
export { MemoryService } from "./services/memory.js";
export { SettingsService } from "./services/settings.js";
export { SchedulerService } from "./services/scheduler.js";
export { InboxService } from "./services/inbox.js";
export { ProactivityService } from "./services/proactivity.js";
export {
  RemoteService,
  loadRemoteConfig,
  saveRemoteConfig,
} from "./services/remote.js";
export { dispatchGateway } from "./dispatch.js";
export {
  NullHostBridge,
  StdioHostBridge,
  type HostBridge,
  type BrowserExecArgs,
  type BrowserExecResult,
} from "./host-bridge.js";

export class Gateway {
  readonly paths: DataPaths;
  private db!: Db;
  tasks!: TaskService;
  audit!: AuditService;
  runner!: TaskRunner;
  artifacts!: ArtifactService;
  memory!: MemoryService;
  settings!: SettingsService;
  scheduler!: SchedulerService;
  inbox!: InboxService;
  proactivity!: ProactivityService;
  remote!: RemoteService;
  remoteSession: RemoteSessionHost | null = null;
  telepresence!: TelepresenceService;
  mutationReceipts!: MutationReceiptService;
  private mutationSingleFlights = new MutationSingleFlight();
  runAttempts!: RunAttemptService;
  scheduleOccurrences!: ScheduleOccurrenceService;
  taskSubmission!: TaskSubmissionService;
  taskCreateAcceptance!: TaskCreateAcceptanceService;
  operationReceipts!: OperationReceiptService;
  conversations!: ConversationService;
  conversationOutbox!: ConversationOutboxRepository;
  private outboxDrain: OutboxDrainCoordinator | null = null;
  declaredArtifacts!: DeclaredArtifactService;
  /** Neutral provider registry — Grok registered only at composition root. */
  providers!: ProviderRegistry;
  private engine!: EngineAdapter;
  private started = false;
  private queueWatchdog: QueueWatchdogControl | null = null;
  private powerGate: PowerStateGate | null = null;
  /** Shared lease guard (null when env does not enable enforcement). */
  private entitlementGuard: EntitlementGuard | null = null;
  /** Injected for tests */
  private engineOverride: EngineAdapter | null;
  private machineId: string;
  private hostBridge: HostBridge;
  /** Server-push sink (stdio notify frames). Set by CLI. */
  private notifySink: ((msg: GatewayNotifyMessage) => void) | null = null;
  /** Debounced tasksChanged / taskEvents push (extracted scheduler). */
  private notifyScheduler = new DebouncedNotifyScheduler(
    () => this.emitNotify("notify.tasksChanged", {}),
    (taskId, seq) => this.emitNotify("notify.taskEvents", { taskId, seq }),
  );

  constructor(
    paths: DataPaths = resolveDataPathsFromProcess(),
    opts?: {
      engine?: EngineAdapter;
      machineId?: string;
      hostBridge?: HostBridge;
    },
  ) {
    this.paths = paths;
    this.engineOverride = opts?.engine ?? null;
    // Prefer explicit device UUID from main (random UUID + Ed25519 identity).
    // Never fingerprint hostname/user/platform for the remaining license.* path.
    this.machineId =
      opts?.machineId?.trim() ||
      process.env.GROKDESK_DEVICE_ID?.trim() ||
      "device-unspecified";
    this.hostBridge = opts?.hostBridge ?? new NullHostBridge();
  }

  setHostBridge(bridge: HostBridge): void {
    this.hostBridge = bridge;
    this.runner?.setHostBridge(bridge);
  }

  /** Called from Electron main powerMonitor (via power.setState IPC). */
  async setPowerState(state: PowerState): Promise<void> {
    await this.powerGate?.setState(state);
  }

  /** Wire server-initiated notify frames (no RPC id) for the desktop UI. */
  setNotifySink(fn: ((msg: GatewayNotifyMessage) => void) | null): void {
    this.notifySink = fn;
  }

  emitNotify<M extends GatewayNotifyMethod>(
    method: M,
    params: GatewayNotifyParams[M],
  ): void {
    try {
      this.notifySink?.({ type: "notify", method, params });
    } catch {
      // never break task execution on push failure
    }
    // CX-2: same notify hooks → sealed t:"event" frames to every paired phone.
    try {
      this.remoteSession?.broadcastNotify(method, params);
    } catch {
      // never break task execution on remote push failure
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    fs.mkdirSync(this.paths.dataDir, { recursive: true });
    fs.mkdirSync(this.paths.logsDir, { recursive: true });
    this.db = openDatabase(this.paths.dbPath);
    this.audit = new AuditService(this.db);
    this.artifacts = new ArtifactService(this.db);
    this.tasks = new TaskService(this.db, {
      onTasksChanged: () => this.notifyScheduler.scheduleTasksChanged(),
      onTaskEvent: (taskId, seq) =>
        this.notifyScheduler.scheduleTaskEvent(taskId, seq),
      // Explicit event hook replaces prior appendEvent monkey-patch (Phase 2/6).
      onEventAppended: (ev) => {
        const create = artifactCreateFromEvent(ev);
        if (!create) return;
        try {
          this.artifacts.create(create);
        } catch {
          // ignore duplicate persistence errors
        }
      },
    });
    cleanupEmptyOrphanWorkspaces({
      dataDir: this.paths.dataDir,
      referencedRoots: this.tasks
        .list()
        .flatMap((task) => task.policySnapshot.workspaceRoots),
    });
    this.memory = new MemoryService(this.db);
    this.settings = new SettingsService(this.db);
    // SEC-02: durable file vault under dataDir; migrate plaintext MCP env → vault refs.
    // Does not touch OS keychain (desktop safeStorage purge remains separate/auth-gated).
    try {
      const vault = createFileCredentialVault(this.paths.dataDir);
      this.settings.setCredentialVault(vault);
      this.settings.migrateLiteralsToVault();
    } catch {
      // Vault failure must not block gateway start; redaction still applies to IPC.
    }
    this.inbox = new InboxService(this.db, {
      onInboxChanged: () => this.emitNotify("notify.inboxChanged", {}),
    });
    this.scheduler = new SchedulerService(
      this.db,
      this.tasks,
      this.settings,
      path.join(this.paths.dataDir, "workspaces"),
    );
    this.proactivity = new ProactivityService(
      this.tasks,
      this.inbox,
      this.settings,
    );
    this.proactivity.setIntelligenceSources({
      memory: this.memory,
      scheduler: this.scheduler,
    });
    this.mutationReceipts = new MutationReceiptService(this.db);
    // Retention: drop stale idempotency receipts (remote offline queue flushes).
    this.mutationReceipts.prune(14);
    this.runAttempts = new RunAttemptService(this.db);
    this.scheduleOccurrences = new ScheduleOccurrenceService(this.db);
    this.scheduleOccurrences.prune(90);
    this.operationReceipts = new OperationReceiptService(this.db);
    this.conversations = new ConversationService(this.db);
    this.conversationOutbox = new ConversationOutboxRepository(this.db);
    // Recover leases left submitting after crash before accepting new drain.
    this.conversationOutbox.releaseExpiredClaims();
    this.conversationOutbox.pruneTerminalReceipts();
    this.outboxDrain = new OutboxDrainCoordinator({
      outbox: this.conversationOutbox,
      db: this.db,
      createFollowUp: (input) => {
        const task = dispatchTasksCreate(
          { ...input } as never,
          desktopRequestContext(`outbox-drain-${input.clientMutationId}`),
          this.taskCreateFlowDeps(),
          {
            principalId: "desktop",
            method: "tasks.create",
            clientMutationId: input.clientMutationId,
            params: input,
          },
        ) as Task;
        const prior =
          (input.parentTaskId
            ? this.tasks.getProviderSessionId(input.parentTaskId)
            : null) ?? null;
        return {
          task,
          kind: prior ? "continue" : "fresh",
        };
      },
      countActiveRuns: () =>
        this.tasks
          .list()
          .filter((t) =>
            ["queued", "running", "waiting_approval", "waiting_user"].includes(
              t.status,
            ),
          ).length,
      maxConcurrentConversations: 3,
      notifyOutboxChanged: (payload) =>
        this.emitNotify("notify.outboxChanged", payload),
      emitMetric: (metric) => this.emitNotify("notify.deliveryMetric", metric),
    });
    this.declaredArtifacts = new DeclaredArtifactService(this.db);
    this.taskSubmission = new TaskSubmissionService(
      this.tasks,
      this.runAttempts,
    );
    this.taskCreateAcceptance = new TaskCreateAcceptanceService({
      tasks: this.tasks,
      runAttempts: this.runAttempts,
      submissions: this.taskSubmission,
      mutationReceipts: this.mutationReceipts,
      operationReceipts: this.operationReceipts,
    });
    // Scheduled ticks use the same submission path as interactive/remote.
    this.scheduler.setTaskSubmission(this.taskSubmission);
    this.telepresence = new TelepresenceService(this.hostBridge, this.settings);
    this.remoteSession = new RemoteSessionHost(this);
    this.telepresence.setFrameSink((deviceId, frame) => {
      // Truthful delivery: only count as sent when the frame was enqueued.
      return this.remoteSession?.pushTeleFrame(deviceId, frame) ?? false;
    });
    this.remote = new RemoteService(this.db, {
      machineId: this.machineId,
      getConfig: () => loadRemoteConfig(this.db),
      setConfig: (partial) => {
        const next = { ...loadRemoteConfig(this.db), ...partial };
        saveRemoteConfig(this.db, next);
        return next;
      },
      onEnabledChange: (enabled) => {
        if (!enabled) {
          void this.telepresence?.stop();
          void this.remoteSession?.stop({ stopTelepresence: true });
        } else {
          void this.remoteSession?.refresh();
        }
      },
      onRemoteChanged: () => this.emitNotify("notify.remoteChanged", {}),
    });
    if (this.remote.status().enabled) {
      void this.remoteSession.start();
    }

    // Composition root: register providers before creating the execution engine.
    // Live ACP factory when CLI probe supports agent stdio; otherwise headless default.
    // Authorization receipts from ACP land in OperationReceiptService.
    const mcpServersProvider = () =>
      resolveDeskPlaneMcpServers({
        mcpServers: this.settings.getMcpServersResolved(),
        env: process.env,
        existsSync: (candidate) => fs.existsSync(candidate),
      });
    const skillsPathsProvider = () => this.settings.getEffectiveSkillsPaths();
    const acpLive = this.engineOverride
      ? null
      : await createLiveAcpTransportFactory({
          mcpServersProvider,
          skillsPathsProvider,
        });
    const engineSelection = resolveEngineSelection({
      env: process.env,
      preferProviderEngine: this.settings.getAll().preferProviderEngine,
      acpAvailable: acpLive !== null,
    });
    this.providers = createDefaultProviderRegistry({
      includeFake: Boolean(this.engineOverride),
      preferAcp: engineSelection.preferAcp,
      acpTransportFactory: acpLive?.factory,
      models: async () => {
        const st = await this.authStatus();
        const ids =
          Array.isArray(st.models) && st.models.length
            ? st.models
            : ["grok-4.5"];
        return ids.map((id) => ({
          id,
          displayName: id,
          providerId: "grok" as const,
          modalities: ["text" as const],
        }));
      },
      onAuthorizationReceipt: (r) => {
        this.operationReceipts.append({
          action: r.action,
          decision: r.decision,
          effect: null,
          detail: {
            capabilityId: r.capabilityId,
            kind: r.kind ?? null,
            title: r.title ?? null,
            reason: r.reason,
          },
          redactionClass: "standard",
        });
      },
    });

    if (this.engineOverride) {
      this.engine = this.engineOverride;
    } else if (engineSelection.mode === "agent-provider") {
      const provider = this.providers.get(engineSelection.providerId);
      if (!provider) {
        throw new Error(
          `AgentProvider engine selected but provider id=${engineSelection.providerId} is not registered (${engineSelection.reasons.join(", ")})`,
        );
      }
      const providerHealth = await provider.probe();
      if (!providerHealth.ok) {
        throw new Error(
          `provider_unavailable: provider id=${engineSelection.providerId} is not runnable (${providerHealth.message ?? "health check failed"})`,
        );
      }
      const fallbackEngine = await createDefaultEngine({
        managedBinaryPath:
          process.env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED ?? null,
        mcpServers: resolveDeskPlaneMcpServers({
          mcpServers: this.settings.getMcpServersResolved(),
          env: process.env,
          existsSync: (candidate) => fs.existsSync(candidate),
        }),
        skillsPaths: this.settings.getEffectiveSkillsPaths(),
      });
      this.engine = createAgentProviderEngine(provider, {
        fallbackEngine,
        // T3: same probe flag as ACP spawn factory (fail closed if null).
        supportsSandbox: acpLive?.supportsSandbox === true,
        mcpServersProvider,
        skillsPathsProvider,
      });
    } else {
      this.engine = await createDefaultEngine({
        managedBinaryPath:
          process.env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED ?? null,
        mcpServers: this.settings.getMcpServersResolved(),
        skillsPaths: this.settings.getEffectiveSkillsPaths(),
      });
    }

    const max = this.settings.getAll().maxConcurrentTasks;
    this.runner = new TaskRunner(this.tasks, this.audit, this.engine, {
      maxConcurrent: max,
      hostBridge: this.hostBridge,
      desktopMachineProvider: () => this.settings.getAll().desktopControl,
      inheritUserGrokProvider: () =>
        this.settings.getAll().inheritUserGrok === true,
      trustedFoldersProvider: () =>
        this.settings.getAll().trustedFolders ?? [],
      runAttempts: this.runAttempts,
      operationReceipts: this.operationReceipts,
      declaredArtifacts: this.declaredArtifacts,
      isTaskReady: (task) =>
        this.taskAttachmentsReady(task) &&
        (task.mode !== "interactive" ||
          this.conversations.hasUserTurn(task.id)),
      // Phase 3 bridge: registry capabilities authorize fail-closed/degraded before engine run.
      providerPreflight: createProviderPreflight(this.providers),
      onRunSettled: () => this.outboxDrain?.schedule(),
      reconcileAssistantTurn: (taskId) => {
        const task = this.tasks.get(taskId);
        if (!task) return;
        reconcileAssistantTurn({
          task,
          events: this.tasks.listAllEvents(taskId),
          appendTurn: (turn) => this.conversations.appendTurn(turn),
        });
      },
    });

    // Entitlement enforcement: path + public JWKS only (main sets env before spawn).
    // No-op when GROKDESK_ENTITLEMENT_STATE_PATH / GROKDESK_LEASE_PUBLIC_JWKS absent.
    // wireEntitlementEnforcement warms the shared guard so the first sync
    // tasks.create admit does not see a null snapshot (unactivated).
    this.entitlementGuard = await wireEntitlementEnforcement({
      taskSubmission: this.taskSubmission,
      scheduler: this.scheduler,
      runner: this.runner,
      remote: this.remoteSession,
      getEngine: () => this.engine,
      setEngine: (engine) => {
        this.engine = engine;
        this.runner?.setEngine(engine);
      },
    });

    // Always prefer desk-browser / desk-desktop MCP when Electron main exposed control planes.
    await this.ensureDeskBrowserEngine(
      engineSelection.mode === "agent-provider",
    );

    // Complete any task acceptance that committed immediately before a crash.
    // Bind every conversation before preparing/pumping any queued run so a
    // concurrent recovery batch cannot start with a partial transcript ledger.
    this.reconcileTaskCreateEffectsOnStartup();

    // TASK-01 partial: recover stale rows after unclean exit (full leases in Phase 2).
    this.recoverInterruptedTasks();

    // Scheduled tasks must pump the runner or they sit in `queued` forever.
    this.scheduler.setOnTasksCreated(async (taskIds) => {
      for (const id of taskIds) {
        // Ensure empty roots get a temp dir (same as interactive create)
        const t = this.tasks.get(id);
        if (t && t.policySnapshot.workspaceRoots.length === 0) {
          // tasks.create already requires roots; scheduler should pass them
        }
      }
      await this.runner.pumpQueue();
    });

    // Artifact persistence is wired via TaskServiceHooks.onEventAppended (no monkey-patch).

    this.scheduler.start(30_000);
    this.proactivity.start(60 * 60_000);
    this.powerGate = new PowerStateGate({
      pauseDispatch: () => this.scheduler?.pause(),
      resumeDispatch: () => this.scheduler?.resume(),
      refreshAuth: async () => {
        await getGrokAuthStatus();
      },
    });
    this.started = true;
    // Global outbox drain (independent of open renderer chat).
    this.outboxDrain?.schedule();
    this.queueWatchdog = startQueueWatchdog({
      pumpQueue: () => {
        this.reconcileQueuedTaskEffects();
        this.outboxDrain?.schedule();
        return this.runner.pumpQueue();
      },
      onError: (error) => {
        try {
          this.audit.append({
            taskId: null,
            action: "queue.watchdog.error",
            detail: {
              message: error instanceof Error ? error.message : String(error),
            },
            decision: "info",
          });
        } catch {
          // Database may be closing; recovery will retry on the next launch.
        }
      },
    });
  }

  /**
   * After crash/restart: mark `running` / `waiting_approval` as interrupted (failed)
   * so they are not permanently phantom-running. Re-pump durable `queued` work.
   */
  private recoverInterruptedTasks(): void {
    recoverInterruptedTasks({
      tasks: this.tasks,
      runAttempts: this.runAttempts,
      pumpQueue: () => this.runner.pumpQueue(),
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.notifyScheduler.clear();
    const queueWatchdog = this.queueWatchdog;
    this.queueWatchdog = null;
    // Stop new watchdog ticks immediately, but let task cancellation below
    // unblock an active pump before we join it and close sqlite.
    const queueWatchdogStopped = queueWatchdog?.stop() ?? Promise.resolve();
    this.scheduler?.stop();
    this.proactivity?.stop();
    // Stop only attempts owned by this process. Shared queued work and live
    // leases owned by another gateway must survive this gateway shutting down.
    await this.runner.stopLocalRuns().catch(() => {});
    await this.telepresence?.stop().catch(() => {});
    await this.remoteSession?.stop({ stopTelepresence: true }).catch(() => {});
    await queueWatchdogStopped;
    // Finish in-flight outbox drain before closing SQLite.
    await this.outboxDrain?.join().catch(() => {});
    this.outboxDrain = null;
    this.db?.close();
    this.started = false;
  }

  async handle(req: IpcRequest, ctx?: RequestContext): Promise<unknown> {
    if (!this.started) throw new Error("Gateway not started");
    const requestCtx: RequestContext = ctx ?? desktopRequestContext(req.id);

    // Durable mutation idempotency (principal + method + clientMutationId).
    const clientMutationId = extractClientMutationId(req);
    if (clientMutationId && IDEMPOTENT_MUTATION_METHODS.has(req.method)) {
      const principalId = mutationPrincipalId(requestCtx);
      const outcome = this.mutationReceipts.begin(
        principalId,
        req.method,
        clientMutationId,
        req.params,
      );
      if (outcome.kind === "duplicate") {
        if (req.method === "tasks.create") {
          const accepted = this.taskCreateAcceptance.resume(
            outcome.receipt.result,
            requestCtx,
          );
          resumeAcceptedTaskCreate(accepted, this.taskCreateFlowDeps());
        }
        return outcome.receipt.result;
      }
      if (outcome.kind === "conflict") {
        throw new Error("clientMutationId reused with different payload");
      }
      return this.mutationSingleFlights.run(
        { principalId, method: req.method, clientMutationId },
        req.params,
        async () => {
          if (req.method === "tasks.create") {
            return dispatchTasksCreate(
              { ...req.params } as never,
              requestCtx,
              this.taskCreateFlowDeps(),
              {
                principalId,
                method: "tasks.create",
                clientMutationId,
                params: req.params,
              },
            );
          }
          const result = await this.dispatch(req, requestCtx);
          this.mutationReceipts.commit(
            principalId,
            req.method,
            clientMutationId,
            req.params,
            result,
          );
          return result;
        },
      );
    }

    return this.dispatch(req, requestCtx);
  }

  private async dispatch(
    req: IpcRequest,
    requestCtx: RequestContext,
  ): Promise<unknown> {
    if (req.method === "power.setState") {
      const state = (req.params as { state?: string })?.state;
      if (state !== "active" && state !== "suspended") {
        throw new Error('power.setState requires state "active" | "suspended"');
      }
      await this.setPowerState(state);
      return { ok: true, state };
    }

    // tasks.create — TaskSubmissionService + RequestContext wiring.
    if (req.method === "tasks.create") {
      return dispatchTasksCreate(
        { ...req.params } as never,
        requestCtx,
        this.taskCreateFlowDeps(),
      );
    }

    // Domain handlers (tasks-core, auth, settings, connectors, workspace, …).
    const domain = await dispatchDomainMethod(
      req.method,
      req.params as Record<string, unknown>,
      this.domainDispatchDeps(),
    );
    if (domain.handled) return domain.result;

    // Remote methods live in remote-dispatch.ts (Phase 6 split).
    if (isRemoteMethod(req.method)) {
      return dispatchRemoteMethod(
        req as Parameters<typeof dispatchRemoteMethod>[0],
        requestCtx,
        {
          remote: this.remote,
          telepresence: this.telepresence,
          remoteSession: this.remoteSession,
        },
      );
    }

    throw new Error(`Unhandled method: ${(req as IpcRequest).method}`);
  }

  private taskCreateFlowDeps() {
    return buildTaskCreateFlowDeps({
      dataDir: this.paths.dataDir,
      resolveWorkspaceRoots: (p) => this.resolveTaskWorkspaceRoots(p),
      lookupRolePack: (id) => getRolePack(id),
      upsertStandingMemory: (item) => this.memory.upsert(item),
      reconcileStandingMemory: (task) =>
        this.reconcileRolePackStandingMemory(task),
      finalizeAttachments: (task) => this.recoverAcceptedTaskAttachments(task),
      submit: (input, ctx) => this.taskSubmission.submit(input, ctx),
      acceptTaskCreate: (input, ctx, mutation) =>
        this.taskCreateAcceptance.accept(input, ctx, mutation),
      appendSubmitReceipt: (input) =>
        this.operationReceipts.append({
          taskId: input.taskId,
          runAttemptId: input.runAttemptId,
          principalId: input.principalId,
          action: "task.submit",
          decision: "info",
          correlationId: input.correlationId,
          detail: input.detail,
        }),
      conversation: this.conversationBindDeps(),
      runWithMemory: (taskId, correlation) =>
        this.runWithMemory(taskId, correlation),
      autoTitle: (taskId, goal, model) => this.autoTitle(taskId, goal, model),
    });
  }

  private conversationBindDeps() {
    return {
      ensureForTask: (
        input: Parameters<ConversationService["ensureForTask"]>[0],
      ) => this.conversations.ensureForTask(input),
      appendTurn: (input: Parameters<ConversationService["appendTurn"]>[0]) =>
        this.conversations.appendTurn(input),
    };
  }

  private reconcileTaskCreateEffectsOnStartup(): void {
    const tasks = sortTasksParentFirst(this.tasks.list());
    const conversation = this.conversationBindDeps();
    for (const task of tasks) {
      this.reconcileRolePackStandingMemory(task);
      tryBindTaskConversation(task, conversation);
    }
    for (const task of tasks) {
      if (task.status !== "done") continue;
      reconcileAssistantTurn({
        task: this.tasks.get(task.id) ?? task,
        events: this.tasks.listAllEvents(task.id),
        appendTurn: (turn) => this.conversations.appendTurn(turn),
      });
    }
    for (const task of tasks) {
      if (task.status !== "queued") continue;
      if (!this.recoverAcceptedTaskAttachments(task)) continue;
      if (!this.conversations.hasUserTurn(task.id)) continue;
      const attempt = this.runAttempts.latestForTask(task.id);
      if (!attempt) continue;
      void this.runWithMemory(
        task.id,
        {
          requestId: `recovery-${task.id}`,
          runAttemptId: attempt.id,
        },
        { pump: false },
      );
    }
    for (const task of tasks) {
      if (!task.parentTaskId && !task.title) {
        void this.autoTitle(task.id, task.goal, task.model);
      }
    }
  }

  private reconcileQueuedTaskEffects(): void {
    const tasks = sortTasksParentFirst(
      this.tasks.list().filter((task) => task.status === "queued"),
    );
    const conversation = this.conversationBindDeps();
    for (const task of tasks) {
      this.reconcileRolePackStandingMemory(task);
      const bound = tryBindTaskConversation(task, conversation);
      if (!this.recoverAcceptedTaskAttachments(task)) continue;
      if (!bound) continue;
      const attempt = this.runAttempts.latestForTask(task.id);
      if (!attempt) continue;
      void this.runWithMemory(
        task.id,
        {
          requestId: `recovery-${task.id}`,
          runAttemptId: attempt.id,
        },
        { pump: false },
      );
    }
  }

  private reconcileRolePackStandingMemory(task: {
    rolePack: string | null;
  }): void {
    if (!task.rolePack) return;
    const pack = getRolePack(task.rolePack);
    if (!pack) return;
    this.memory.upsert(standingMemoryForRolePack(pack));
  }

  private finalizeAcceptedTaskAttachments(task: Task): void {
    if (!Array.isArray(task.attachments) || task.attachments.length === 0) {
      return;
    }
    const primary = task.policySnapshot.workspaceRoots[0];
    if (!primary) throw new Error("Accepted attachment task has no workspace");
    finalizeTaskAttachments(primary, task.attachments);
  }

  /**
   * Materialize accepted bytes with a durable, bounded failure budget. A task
   * may remain queued for transient filesystem recovery, but never forever.
   */
  private recoverAcceptedTaskAttachments(task: Task): boolean {
    const retryCode = "attachment_recovery_retry";
    const priorFailures = this.tasks
      .listEvents(task.id)
      .filter((event) => event.payload.code === retryCode).length;
    try {
      this.finalizeAcceptedTaskAttachments(task);
      if (
        priorFailures > 0 &&
        !this.tasks
          .listEvents(task.id)
          .some(
            (event) => event.payload.code === "attachment_recovery_succeeded",
          )
      ) {
        this.tasks.appendEvent(task.id, "step", {
          code: "attachment_recovery_succeeded",
          title: "Attachment recovered",
          status: "end",
          attempts: priorFailures,
        });
      }
      return true;
    } catch {
      const maxAttempts = 3;
      const attempt = priorFailures + 1;
      this.tasks.appendEvent(task.id, "step", {
        code: retryCode,
        title: `Attachment unavailable; retrying (${Math.min(attempt, maxAttempts)}/${maxAttempts})`,
        status: "retry",
        attempt,
        maxAttempts,
      });
      const durableFailures = this.tasks
        .listEvents(task.id)
        .filter((event) => event.payload.code === retryCode).length;
      const current = this.tasks.get(task.id);
      if (durableFailures >= maxAttempts && current?.status === "queued") {
        const latest = this.runAttempts.latestForTask(task.id);
        if (latest && !this.runAttempts.isTerminal(latest.status)) {
          let errorEvent: ReturnType<TaskService["appendEvent"]> | null = null;
          try {
            const completed = this.runAttempts.completeUnclaimedAtomically(
              latest.id,
              "failed",
              "attachment_recovery_failed",
              () => {
                errorEvent = this.tasks.appendEvent(
                  task.id,
                  "error",
                  {
                    code: "attachment_recovery_failed",
                    message:
                      "The accepted attachment is no longer available or changed before it could be recovered. Edit this message and attach the file again.",
                    recoverable: true,
                    action: "edit_and_retry",
                  },
                  { emitHooks: false },
                );
                if (
                  !this.tasks.transitionStatus(task.id, ["queued"], "failed", {
                    emitHooks: false,
                  })
                ) {
                  throw new Error("attachment_task_transition_lost");
                }
              },
            );
            if (completed && errorEvent) {
              this.tasks.emitDeferredEvent(errorEvent);
              this.tasks.emitTaskStatusChanged(task.id, "failed");
            }
          } catch {
            // A runner won the claim race; the transaction rolled back all
            // attachment-failure state and that owner now decides the task.
          }
        }
      }
      return false;
    }
  }

  private taskAttachmentsReady(task: Task): boolean {
    if (!Array.isArray(task.attachments)) return true;
    return task.attachments.every((attachment) => {
      if (attachment.kind === "file") return true;
      if (!attachment.stagedPath) return false;
      try {
        return fs.statSync(attachment.stagedPath).isFile();
      } catch {
        return false;
      }
    });
  }

  /** Deps for extracted domain IPC dispatchers (Phase 6). */
  private domainDispatchDeps() {
    return buildDomainDispatchDeps({
      paths: this.paths,
      tasks: this.tasks,
      runner: this.runner,
      runAttempts: this.runAttempts,
      audit: {
        append: (entry) => {
          this.audit.append({
            taskId: entry.taskId,
            action: entry.action,
            detail: entry.detail,
            decision: normalizeAuditDecision(entry.decision),
          });
        },
        list: (params) => this.audit.list(params),
      },
      settings: this.settings,
      scheduler: {
        list: () => this.scheduler.list(),
        create: (p) => this.scheduler.create(p as never),
        setEnabled: (id, enabled) => this.scheduler.setEnabled(id, enabled),
        delete: (id) => this.scheduler.delete(id),
      },
      memory: {
        list: (kind) => this.memory.list(kind as never),
        upsert: (p) => this.memory.upsert(p as never),
        delete: (id) => this.memory.delete(id),
      },
      inbox: this.inbox,
      artifacts: this.artifacts,
      deleteChat: (taskId) => this.deleteChat(taskId),
      authStatus: () => this.authStatus(),
      authSignIn: () => this.authSignIn(),
      authSignOut: () => this.authSignOut(),
      computeTrayStatus: () => this.computeTrayStatus(),
      getGrokAuthStatus: () => getGrokAuthStatus(),
      ensureTempWorkspace: (label) => this.ensureTempWorkspace(label),
      listWorkspaceFiles: (root, max) => this.listWorkspaceFiles(root, max),
      readWorkspaceFile: (path, maxChars) =>
        this.readWorkspaceFile(path, maxChars),
      readWorkspaceAsset: (path, maxBytes, root) =>
        this.readWorkspaceAsset(path, maxBytes, root),
      prepareWorkspaceAsset: (path, maxBytes, root) =>
        this.prepareWorkspaceAsset(path, maxBytes, root),
      applyEngineSettings: (prev, next) => this.applyEngineSettings(prev, next),
      connectorOpsDeps: () => this.connectorOpsDeps(),
      desktopTaskOpsDeps: () => this.desktopTaskOpsDeps(),
      outboxDispatch: {
        outbox: this.conversationOutbox,
        notifyOutboxChanged: (payload) =>
          this.emitNotify("notify.outboxChanged", payload),
        scheduleDrain: () => {
          try {
            this.conversationOutbox.releaseExpiredClaims();
          } catch {
            /* never break IPC */
          }
          this.outboxDrain?.schedule();
        },
        interject: (taskId, text, clientMutationId) =>
          this.runner.interject(taskId, text, clientMutationId),
        supportsInterject: () => typeof this.engine.interject === "function",
      },
    });
  }

  /**
   * Create a unique workspace folder for chat-style runs.
   * Always under the app data dir (`…/GrokDesk/workspaces/`), never OS temp
   * and never inside the user's project tree.
   */
  ensureTempWorkspace(label = "chat"): string {
    return ensureTempWorkspaceImpl(this.paths.dataDir, label);
  }

  /**
   * Resolve workspace roots for a new task:
   * - Follow-ups inherit the parent chat's roots (one workspace per chat).
   * - When the user chose a project folder, it is primary (cwd + deliverables).
   * - A managed chat workspace is still created (secondary with a project, or
   *   sole root for folder-less chats).
   */
  resolveTaskWorkspaceRoots(params: {
    workspaceRoots?: string[];
    parentTaskId?: string | null;
  }): string[] {
    let parentRoots: string[] | null = null;
    if (params.parentTaskId) {
      const parent = this.tasks.get(params.parentTaskId);
      parentRoots = parent?.policySnapshot.workspaceRoots ?? null;
    }
    return resolveTaskWorkspaceRootsImpl({
      dataDir: this.paths.dataDir,
      workspaceRoots: params.workspaceRoots,
      parentRoots,
      ensureTemp: (label) => this.ensureTempWorkspace(label),
    });
  }

  private async autoTitle(
    taskId: string,
    goal: string,
    model: string,
  ): Promise<void> {
    await autoTitleTask(
      this.tasks,
      taskId,
      goal,
      model,
      undefined,
      this.entitlementGuard,
    );
  }

  /** Re-apply last-inference wrap after engine rebuilds / desk-plane inject. */
  private installEngine(engine: EngineAdapter): void {
    const wrapped = wrapEngineWithEntitlementGuard(
      engine,
      this.entitlementGuard,
    );
    this.engine = wrapped;
    this.runner?.setEngine(wrapped);
  }

  /**
   * Delete a whole chat thread (root + follow-up turns): cancels any running
   * member, removes DB rows, and deletes the workspace folder *only* when it's
   * an app-managed one under the data dir — never a user's own project folder.
   */
  private async deleteChat(
    taskId: string,
  ): Promise<{ ok: true; deletedIds: string[] }> {
    return deleteChatThread(taskId, {
      tasks: this.tasks,
      runner: this.runner,
      hostBridge: this.hostBridge,
      dataDir: this.paths.dataDir,
    });
  }

  /**
   * List recent files under a workspace root (shallow + one level).
   * Users want "what did Grok leave on disk?" even without formal artifacts.
   */
  listWorkspaceFiles(
    root: string,
    max = 40,
  ): Array<{ name: string; path: string; isDir: boolean; mtimeMs: number }> {
    return listWorkspaceFilesImpl(root, max, this.allowedWorkspaceRoots());
  }

  /**
   * Roots allowed for workspace.readFile / readAsset / prepareAsset IPC.
   * Union of task policy roots + managed workspaces base.
   */
  private allowedWorkspaceRoots(): string[] {
    return collectAllowedWorkspaceRoots({
      dataDir: this.paths.dataDir,
      taskRoots: this.tasks
        .list()
        .flatMap((task) => task.policySnapshot.workspaceRoots),
    });
  }

  /**
   * Read a text-ish workspace file for in-app preview.
   * Refuses binary blobs and paths outside known task / managed workspace roots.
   */
  readWorkspaceFile(
    filePath: string,
    maxChars = 80_000,
  ): {
    path: string;
    name: string;
    content: string;
    truncated: boolean;
    size: number;
  } {
    return readWorkspaceFilePreview(filePath, maxChars, {
      allowedRoots: this.allowedWorkspaceRoots(),
    });
  }

  /**
   * Resolve + validate a media path for preview without reading bytes.
   * Main process mints a tokenized protocol URL from this metadata.
   */
  prepareWorkspaceAsset(
    filePath: string,
    maxBytes = 256 * 1024 * 1024,
    root?: string,
  ): { path: string; name: string; mime: string; size: number } {
    return prepareWorkspaceAssetMeta(
      filePath,
      maxBytes,
      root,
      this.allowedWorkspaceRoots(),
    );
  }

  /**
   * Read an image or video file and return it as a base64 data URL for inline
   * preview. Refuses unknown types and oversized files so we never inline
   * arbitrary blobs.
   *
   * Relative paths resolve against `root` (workspace) when provided; otherwise
   * against process cwd — which is wrong for packaged apps.
   *
   * Prefer prepareWorkspaceAsset + custom protocol for large/video assets.
   */
  readWorkspaceAsset(
    filePath: string,
    maxBytes = 64 * 1024 * 1024,
    root?: string,
  ): {
    path: string;
    name: string;
    mime: string;
    dataUrl: string;
    size: number;
  } {
    return readWorkspaceAssetDataUrl(
      filePath,
      maxBytes,
      root,
      this.allowedWorkspaceRoots(),
    );
  }

  private async runWithMemory(
    taskId: string,
    correlation?: { requestId?: string; runAttemptId?: string },
    opts?: { pump?: boolean },
  ): Promise<void> {
    runWithMemoryImpl(
      taskId,
      {
        getTask: (id) => this.tasks.get(id),
        retrieveMemory: (goal) => this.memory.retrieve(goal),
        formatMemoryPreamble: (items) => this.memory.formatPreamble(items),
        loadAttachmentsPreamble: (root) => loadAttachmentsPreamble(root),
        getConversationId: (id) => {
          try {
            const row = this.db
              .prepare(`SELECT conversation_id as cid FROM tasks WHERE id = ?`)
              .get(id) as { cid: string | null } | undefined;
            return row?.cid ?? null;
          } catch {
            return null;
          }
        },
        buildTranscriptFallback: (cid, opts) =>
          this.conversations.buildTranscriptFallback(cid, opts),
        setRunContext: (ctx) => this.runner.setRunContext(ctx),
        pumpQueue: () => {
          if (opts?.pump === false) return;
          void this.runner.pumpQueue();
        },
      },
      correlation,
    );
  }

  private async authStatus(): Promise<AuthState & { models?: string[] }> {
    return authStatus();
  }

  private async authSignIn(): Promise<{ ok: boolean; message: string }> {
    return authSignIn();
  }

  private async authSignOut(): Promise<{
    ok: boolean;
    signedOut: boolean;
    message?: string;
  }> {
    return authSignOut();
  }

  private computeTrayStatus(): {
    status: TrayStatus;
    runningCount: number;
    inboxBadge: number;
    needsInput: boolean;
    notificationTitle: string | null;
  } {
    const view = computeTrayStatus(this.tasks.list(), this.tasks.isPaused());
    try {
      syncInboxFromWaitingOnYou(this.inbox, view);
    } catch {
      /* inbox is best-effort; tray status must still return */
    }
    return view;
  }

  /**
   * Prepend desk-browser + desk-desktop MCP when main exported control planes.
   * Safe to call after start and after settings-driven engine rebuilds.
   */
  private async ensureDeskBrowserEngine(
    preserveCurrentEngine = false,
  ): Promise<void> {
    await ensureDeskPlanesEngine({
      hasEngineOverride: !!this.engineOverride,
      preserveCurrentEngine,
      existsSync: (p) => fs.existsSync(p),
      getSettings: () => this.settings.getAll(),
      getEffectiveSkillsPaths: () => this.settings.getEffectiveSkillsPaths(),
      createEngine: async (input) =>
        createDefaultEngine({
          managedBinaryPath:
            process.env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED ?? null,
          mcpServers: input.mcpServers,
          skillsPaths: input.skillsPaths,
        }),
      setEngine: (engine) => this.installEngine(engine),
    });
  }

  /**
   * Rebuild Grok Build engine when MCP/skills/provider-mode change.
   * Uses the main-process runtime-store-resolved binary (never ambient PATH
   * discovery or a user-provided managed-binary override).
   * @returns true if the engine object was replaced.
   */
  /**
   * Serializes engine rebuilds. settings.set is not an idempotent mutation, so
   * two rapid toggles (e.g. disabling two MCP servers) each run
   * applyEngineSettings concurrently; without ordering, whichever slow
   * createEngine (ACP probe + registry rebuild) resolves last wins setEngine,
   * silently installing a stale engine reflecting an earlier settings snapshot.
   * Chaining makes rebuilds run in submission order so the final engine matches
   * the final settings.
   */
  private engineRebuildChain: Promise<unknown> = Promise.resolve();

  private applyEngineSettings(
    prev: AppSettings,
    next: AppSettings,
  ): Promise<boolean> {
    const run = this.engineRebuildChain
      .catch(() => undefined)
      .then(() => this.rebuildEngineForSettings(prev, next));
    // Keep the chain alive even if a rebuild rejects.
    this.engineRebuildChain = run.catch(() => undefined);
    return run;
  }

  private async rebuildEngineForSettings(
    prev: AppSettings,
    next: AppSettings,
  ): Promise<boolean> {
    let rebuiltWithAgentProvider = false;
    return applyEngineSettingsRebuild(prev, next, {
      hasRunner: !!this.runner,
      hasEngineOverride: !!this.engineOverride,
      setMaxConcurrent: (n) => this.runner?.setMaxConcurrent(n),
      settingsChanged: engineSettingsChanged,
      createEngine: async (s) => {
        const mcpServersProvider = () =>
          resolveDeskPlaneMcpServers({
            mcpServers: this.settings.getMcpServersResolved(),
            env: process.env,
            existsSync: (candidate) => fs.existsSync(candidate),
          });
        const skillsPathsProvider = () =>
          this.settings.getEffectiveSkillsPaths();
        const acpLive = await createLiveAcpTransportFactory({
          mcpServersProvider,
          skillsPathsProvider,
        });
        const selection = resolveEngineSelection({
          env: process.env,
          preferProviderEngine: s.preferProviderEngine,
          acpAvailable: acpLive !== null,
        });
        rebuiltWithAgentProvider = selection.mode === "agent-provider";
        if (selection.mode === "agent-provider") {
          // Rebuild registry so ACP factory / preferAcp track current probe.
          this.providers = createDefaultProviderRegistry({
            includeFake: Boolean(this.engineOverride),
            preferAcp: selection.preferAcp,
            acpTransportFactory: acpLive?.factory,
            models: async () => {
              const st = await this.authStatus();
              const ids =
                Array.isArray(st.models) && st.models.length
                  ? st.models
                  : ["grok-4.5"];
              return ids.map((id) => ({
                id,
                displayName: id,
                providerId: "grok" as const,
                modalities: ["text" as const],
              }));
            },
            onAuthorizationReceipt: (r) => {
              this.operationReceipts.append({
                action: r.action,
                decision: r.decision,
                effect: null,
                detail: {
                  capabilityId: r.capabilityId,
                  kind: r.kind ?? null,
                  title: r.title ?? null,
                  reason: r.reason,
                },
                redactionClass: "standard",
              });
            },
          });
          const provider = this.providers.get(selection.providerId);
          if (!provider) {
            throw new Error(
              `AgentProvider rebuild: provider id=${selection.providerId} not registered`,
            );
          }
          const providerHealth = await provider.probe();
          if (!providerHealth.ok) {
            throw new Error(
              `provider_unavailable: provider id=${selection.providerId} is not runnable (${providerHealth.message ?? "health check failed"})`,
            );
          }
          const fallbackEngine = await createDefaultEngine({
            managedBinaryPath:
              process.env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED ?? null,
            mcpServers: resolveDeskPlaneMcpServers({
              mcpServers: this.settings.getMcpServersResolved(),
              env: process.env,
              existsSync: (candidate) => fs.existsSync(candidate),
            }),
            skillsPaths: this.settings.getEffectiveSkillsPaths(),
          });
          return createAgentProviderEngine(provider, {
            fallbackEngine,
            supportsSandbox: acpLive?.supportsSandbox === true,
            mcpServersProvider,
            skillsPathsProvider,
          });
        }
        return createDefaultEngine({
          managedBinaryPath:
            process.env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED ?? null,
          // Resolve vault refs for engine env only — SQLite keeps opaque refs.
          mcpServers: this.settings.getMcpServersResolved(),
          skillsPaths: this.settings.getEffectiveSkillsPaths(),
        });
      },
      setEngine: (engine) => this.installEngine(engine),
      // Re-inject desk-browser after settings rebuild (MCP list may have dropped it).
      afterRebuild: () =>
        this.ensureDeskBrowserEngine(rebuiltWithAgentProvider),
    });
  }

  /** Shared deps for connectors.* IPC handlers. */
  private connectorOpsDeps() {
    return {
      getAll: () =>
        this.settings.getAll() as ReturnType<typeof this.settings.getAll> &
          Record<string, unknown>,
      enablePreset: (presetId: string, env?: Record<string, string>) =>
        this.settings.enableConnectorPreset(presetId, env) as ReturnType<
          typeof this.settings.enableConnectorPreset
        > &
          Record<string, unknown>,
      disablePreset: (presetId: string) =>
        this.settings.disableConnectorPreset(presetId) as ReturnType<
          typeof this.settings.disableConnectorPreset
        > &
          Record<string, unknown>,
      enableRecommended: () =>
        this.settings.enableRecommendedConnectors() as ReturnType<
          typeof this.settings.enableRecommendedConnectors
        > &
          Record<string, unknown>,
      getEffectiveSkillsPaths: () => this.settings.getEffectiveSkillsPaths(),
      applyEngineSettings: async (
        prev: Record<string, unknown>,
        next: Record<string, unknown>,
      ) =>
        this.applyEngineSettings(
          prev as unknown as AppSettings,
          next as unknown as AppSettings,
        ),
      doctorMcpServers: (
        servers: Array<{
          id: string;
          command: string;
          args: string[];
          env?: Record<string, string>;
          enabled: boolean;
        }>,
      ) => doctorMcpServers(servers),
    };
  }

  /** Shared deps for desktop.task.* grant IPC handlers. */
  private desktopTaskOpsDeps() {
    return {
      getGrant: (taskId: string) => this.runner.getDesktopGrant(taskId),
      setGrant: (taskId: string, granted: boolean, displayId?: string | null) =>
        this.runner.setDesktopGrant(taskId, granted, displayId),
      threadRootId: (taskId: string) => this.tasks.threadRootId(taskId),
      getMachineSettings: () => this.settings.getAll().desktopControl,
      desktopGetStatus: (root: string) =>
        this.hostBridge.desktopGetStatus(root),
      desktopConfigure: (input: {
        taskId: string;
        granted: boolean;
        displayId: string | null;
        machine: unknown;
        clearSoftPause?: boolean;
      }) =>
        this.hostBridge.desktopConfigure(
          input as Parameters<typeof this.hostBridge.desktopConfigure>[0] & {
            clearSoftPause?: boolean;
          },
        ),
    };
  }

}

function sortTasksParentFirst(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depths = new Map<string, number>();
  const depthOf = (task: Task, visiting = new Set<string>()): number => {
    const known = depths.get(task.id);
    if (known !== undefined) return known;
    if (!task.parentTaskId || visiting.has(task.id)) {
      depths.set(task.id, 0);
      return 0;
    }
    const parent = byId.get(task.parentTaskId);
    if (!parent) {
      depths.set(task.id, 0);
      return 0;
    }
    visiting.add(task.id);
    const depth = depthOf(parent, visiting) + 1;
    visiting.delete(task.id);
    depths.set(task.id, depth);
    return depth;
  };
  return [...tasks].sort((a, b) => {
    const depth = depthOf(a) - depthOf(b);
    if (depth !== 0) return depth;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}

export type { RequestContext } from "./services/request-context.js";
export {
  desktopRequestContext,
  remoteRequestContext,
  resolveRemoteDeviceId,
} from "./services/request-context.js";
export { MutationReceiptService } from "./services/mutation-receipts.js";
