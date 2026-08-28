/**
 * Build DomainDispatchDeps from gateway service bag (Phase 6 extract).
 * Keeps Gateway.index free of the large deps object literal.
 */

import type { DomainDispatchDeps } from "./domain-dispatch.js";
import {
  isMainProcessAuthMethod,
  mainProcessAuthErrorMessage,
} from "./main-process-auth.js";
import { registerBrowserHostApproval } from "./browser-host-approval.js";
import {
  getDesktopTaskGrant,
  resumeDesktopTask,
  setDesktopTaskGrant,
} from "./desktop-task-ops.js";
import {
  disableConnector,
  doctorConnectors,
  enableConnector,
  enableRecommendedConnectors,
} from "./connector-ops.js";
import type { AppSettings } from "./settings.js";
import type {
  AuditEntry,
  InboxItem,
  Task,
  TaskEvent,
} from "@grokdesk/shared";
import { scanForeignSessionsFromHome } from "./session-roster.js";
import {
  buildBrowserCapabilityHandshake,
  detectDeskControlPlanes,
  readDeskPlaneEnv,
} from "./desk-mcp-planes.js";

/**
 * Minimal service surface required to wire domain IPC dispatchers.
 * Avoids importing the Gateway class (breaks circular deps).
 */
export type GatewayDomainServiceBag = {
  paths: { dataDir: string };
  tasks: {
    list: () => unknown;
    get: (id: string) => { status?: string } | null | undefined;
    setTitle: (id: string, title: string) => unknown;
    pauseAll: () => void;
    resumeAll: () => void;
    listEvents: (
      taskId: string,
      afterSeq: number,
    ) => TaskEvent[];
  };
  runner: {
    cancel: (taskId: string) => Promise<void>;
    approve: (
      approvalId: string,
      decision: "approve" | "reject",
    ) => Promise<void>;
    registerHostBrowserApproval: (input: {
      approvalId: string;
      taskId: string;
      tool: string;
      reason: string;
      url?: string;
      args?: Record<string, unknown>;
    }) => void;
    pumpQueue: () => Promise<void>;
    harvestWorkspaceDeliverables: (taskId: string) => unknown;
    openLocalHtml?: (
      taskId: string,
      htmlPath: string,
    ) => Promise<{ ok: boolean; output: string }>;
    openUrlInAgentBrowser?: (
      taskId: string,
      url: string,
    ) => Promise<{ ok: boolean; output: string }>;
    interject: (
      taskId: string,
      text: string,
      clientMutationId?: string,
    ) => Promise<boolean>;
    compact: (taskId: string) => Promise<boolean>;
    rewindPoints: (
      taskId: string,
    ) => Promise<Array<{ id: string; label?: string }> | null>;
    rewindTo: (
      taskId: string,
      pointId: string,
      turnId?: string,
    ) => Promise<boolean>;
  };
  runAttempts: {
    latestUsage: (taskId: string) => {
      inputTokens: number;
      outputTokens: number;
      contextWindow?: number;
    } | null;
  };
  audit: {
    append: (entry: {
      taskId: string | null;
      action: string;
      detail: Record<string, unknown>;
      decision?: string | null;
    }) => void;
    list: (params?: {
      taskId?: string | null;
      decision?: "allow" | "deny" | "approve" | "reject" | "info" | null;
      limit?: number;
      offset?: number;
    }) => {
      entries: AuditEntry[];
      hasMore: boolean;
      total: number;
      limit: number;
      offset: number;
    };
  };
  settings: {
    getAll: () => unknown;
    getBundledSkillsInfo: () => {
      found: boolean;
      root: string | null;
      packs: unknown[];
    };
    getEffectiveSkillsPaths: () => string[];
    set: (params: Record<string, unknown>) => unknown;
    listConnectorPresets: () => unknown;
    scanLiteralSecrets?: () => Array<{
      serverId: string;
      envKey: string;
      kind: string;
    }>;
    vaultStatus?: () => { attached: boolean; hardened: boolean };
    migrateLiteralsToVault?: (opts?: {
      dryRun?: boolean;
    }) => {
      dryRun: boolean;
      migrated: Array<{ serverId: string; envKey: string; kind: string }>;
      alreadySafe: Array<{ serverId: string; envKey: string; kind: string }>;
      hasRemainingLiterals: boolean;
    };
  };
  scheduler: {
    list: () => unknown;
    create: (params: unknown) => unknown;
    setEnabled: (id: string, enabled: boolean) => void;
    delete: (id: string) => void;
  };
  memory: {
    list: (kind?: unknown) => unknown;
    upsert: (params: unknown) => unknown;
    delete: (id: string) => void;
  };
  inbox: {
    list: () => unknown;
    markRead: (id: string) => void;
    dismiss: (id: string) => void;
  };
  artifacts: {
    list: (taskId?: string) => unknown;
  };
  deleteChat: (taskId: string) => unknown | Promise<unknown>;
  authStatus: () => unknown | Promise<unknown>;
  authSignIn: () => unknown | Promise<unknown>;
  authSignOut: () => unknown | Promise<unknown>;
  computeTrayStatus: () => unknown;
  getGrokAuthStatus: () => Promise<unknown>;
  listLiveModels?: () => Promise<string[]>;
  ensureTempWorkspace: (label: string) => unknown;
  listWorkspaceFiles: (root: string, max: number) => unknown;
  readWorkspaceFile: (path: string, maxChars: number) => unknown;
  readWorkspaceAsset: (
    path: string,
    maxBytes: number,
    root?: string,
  ) => unknown;
  prepareWorkspaceAsset: (
    path: string,
    maxBytes: number,
    root?: string,
  ) => unknown;
  applyEngineSettings: (
    prev: AppSettings,
    next: AppSettings,
  ) => Promise<boolean>;
  connectorOpsDeps: () => Parameters<typeof enableConnector>[1];
  desktopTaskOpsDeps: () => Parameters<typeof getDesktopTaskGrant>[1];
  /** Optional until renderer cutover; when set, routes outbox.* IPC. */
  outboxDispatch?: DomainDispatchDeps["outbox"];
};

/**
 * Construct DomainDispatchDeps from a gateway service bag.
 */
export function buildDomainDispatchDeps(
  g: GatewayDomainServiceBag,
): DomainDispatchDeps {
  return {
    tasksCore: {
      list: () => g.tasks.list(),
      get: (taskId) => g.tasks.get(taskId),
      cancel: (taskId) => g.runner.cancel(taskId),
      setTitle: (taskId, title) => g.tasks.setTitle(taskId, title),
      deleteChat: (taskId) => g.deleteChat(taskId),
      approve: (approvalId, decision) =>
        g.runner.approve(approvalId, decision),
      registerBrowserHostApproval: (p) =>
        registerBrowserHostApproval(
          p as {
            approvalId: string;
            taskId: string;
            tool: string;
            reason: string;
            url?: string;
            args?: Record<string, unknown>;
          },
          {
            registerHostBrowserApproval: (input) =>
              g.runner.registerHostBrowserApproval(input),
            appendAudit: (entry) => g.audit.append(entry),
          },
        ),
      browserCapability: () => {
        const plane = readDeskPlaneEnv(process.env);
        const detection = detectDeskControlPlanes(plane);
        return buildBrowserCapabilityHandshake(plane, detection);
      },
      allowExternalBrowser: (p) => {
        const allowed = Boolean(p.allowed);
        // Persist soft flag for this gateway process (explicit user choice).
        process.env.GROKDESK_ALLOW_EXTERNAL_BROWSER = allowed ? "1" : "0";
        return { ok: true, allowed };
      },
      openLocalHtml: async (p) => {
        const taskId = String(p.taskId ?? "").trim();
        const htmlPath = String(p.path ?? p.url ?? "").trim();
        if (!taskId || !htmlPath) {
          return { ok: false, output: "taskId and path required" };
        }
        if (!g.runner.openLocalHtml) {
          return { ok: false, output: "runner cannot open local HTML" };
        }
        return g.runner.openLocalHtml(taskId, htmlPath);
      },
      openUrl: async (p) => {
        const taskId = String(p.taskId ?? "").trim();
        const url = String(p.url ?? "").trim();
        if (!taskId || !url) {
          return { ok: false, output: "taskId and url required" };
        }
        if (!g.runner.openUrlInAgentBrowser) {
          return { ok: false, output: "runner cannot open URL" };
        }
        return g.runner.openUrlInAgentBrowser(taskId, url);
      },
      pauseAll: () => g.tasks.pauseAll(),
      resumeAll: () => g.tasks.resumeAll(),
      pumpQueue: () => {
        void g.runner.pumpQueue();
      },
      interject: (taskId, text, clientMutationId) =>
        g.runner.interject(taskId, text, clientMutationId),
      compact: (taskId) => g.runner.compact(taskId),
      contextUsage: (taskId) => g.runAttempts.latestUsage(taskId),
      rewindPoints: (taskId) => g.runner.rewindPoints(taskId),
      rewind: (taskId, pointId, turnId) =>
        g.runner.rewindTo(taskId, pointId, turnId),
    },
    auth: {
      authStatus: () => g.authStatus(),
      authSignIn: () => g.authSignIn(),
      authSignOut: () => g.authSignOut(),
      isMainProcessAuthMethod,
      mainProcessAuthErrorMessage,
    },
    desktopTask: {
      getGrant: (taskId) =>
        getDesktopTaskGrant(taskId, g.desktopTaskOpsDeps()),
      setGrant: (p) => setDesktopTaskGrant(p, g.desktopTaskOpsDeps()),
      resume: (taskId) => resumeDesktopTask(taskId, g.desktopTaskOpsDeps()),
    },
    settings: {
      getAll: () =>
        g.settings.getAll() as unknown as Record<string, unknown> & {
          mcpServers?: Array<{
            id: string;
            command: string;
            args: string[];
            env?: Record<string, string>;
            enabled: boolean;
          }>;
        },
      getBundledSkillsInfo: () => g.settings.getBundledSkillsInfo(),
      getEffectiveSkillsPaths: () => g.settings.getEffectiveSkillsPaths(),
      set: (p) => g.settings.set(p) as unknown as Record<string, unknown>,
      applyEngineSettings: async (prev, next) =>
        g.applyEngineSettings(
          prev as unknown as AppSettings,
          next as unknown as AppSettings,
        ),
      scanLiteralSecrets: g.settings.scanLiteralSecrets
        ? () => g.settings.scanLiteralSecrets!() as never
        : undefined,
      // Bind method so `this` is SettingsService (unbound assignment throws on this.vault).
      vaultStatus: g.settings.vaultStatus
        ? () => g.settings.vaultStatus!()
        : undefined,
      migrateLiteralsToVault: g.settings.migrateLiteralsToVault
        ? (opts) => g.settings.migrateLiteralsToVault!(opts) as never
        : undefined,
    },
    licenseMeta: {
      computeTrayStatus: () => g.computeTrayStatus(),
      getGrokAuthStatus: () => g.getGrokAuthStatus(),
      listLiveModels: g.listLiveModels
        ? () => g.listLiveModels!()
        : undefined,
    },
    connectors: {
      listPresets: () => g.settings.listConnectorPresets(),
      enable: (input) => enableConnector(input, g.connectorOpsDeps()),
      disable: (presetId) =>
        disableConnector(presetId, g.connectorOpsDeps()),
      enableRecommended: () =>
        enableRecommendedConnectors(g.connectorOpsDeps()),
      doctor: (serverId) => doctorConnectors(g.connectorOpsDeps(), serverId),
    },
    workspace: {
      ensureTemp: (label) => g.ensureTempWorkspace(label),
      listFiles: (root, max) => g.listWorkspaceFiles(root, max),
      readFile: (path, maxChars) => g.readWorkspaceFile(path, maxChars),
      readAsset: (path, maxBytes, root) =>
        g.readWorkspaceAsset(path, maxBytes, root),
      prepareAsset: (path, maxBytes, root) =>
        g.prepareWorkspaceAsset(path, maxBytes, root),
    },
    sideData: {
      scheduleList: () => g.scheduler.list(),
      scheduleCreate: (p) => g.scheduler.create(p as never),
      scheduleSetEnabled: (id, enabled) =>
        g.scheduler.setEnabled(id, enabled),
      scheduleDelete: (id) => g.scheduler.delete(id),
      memoryList: (kind) => g.memory.list(kind as never),
      memoryUpsert: (p) => g.memory.upsert(p as never),
      memoryDelete: (id) => g.memory.delete(id),
      inboxList: () => g.inbox.list(),
      inboxMarkRead: (id) => g.inbox.markRead(id),
      inboxDismiss: (id) => g.inbox.dismiss(id),
      auditList: (params) => g.audit.list(params),
    },
    eventsExport: {
      listEvents: (taskId, afterSeq) =>
        g.tasks.listEvents(taskId, afterSeq),
      getTask: (id) => g.tasks.get(id),
      listTasks: () => g.tasks.list() as unknown[],
      dataDir: g.paths.dataDir,
    },
    artifactsList: {
      getTaskStatus: (taskId) => g.tasks.get(taskId)?.status,
      harvest: (taskId) => g.runner.harvestWorkspaceDeliverables(taskId),
      list: (taskId) => g.artifacts.list(taskId),
    },
    outbox: g.outboxDispatch,
    sessionRoster: {
      listTasks: () => g.tasks.list() as Task[],
      needsInputIds: () => {
        const ids = new Set<string>();
        for (const item of g.inbox.list() as InboxItem[]) {
          if (
            item.taskId &&
            (item.kind === "approval" || item.kind === "clarification")
          ) {
            ids.add(item.taskId);
          }
        }
        return ids;
      },
      scanForeign: (opts) =>
        scanForeignSessionsFromHome({ cwd: opts.cwd ?? null }),
    },
  };
}
