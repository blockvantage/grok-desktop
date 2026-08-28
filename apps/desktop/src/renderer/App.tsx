import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteTask,
  pickDirectory,
  renameTask,
  revealPath,
  rpc,
  subscribeGatewayStatus,
  subscribeGatewayNotify,
  subscribeNavigate,
  getGatewayStatus,
  openBilling,
  getUsage,
  openLogsFolder,
  copyDiagnostics,
  restartGateway,
  taskInterject,
  taskCompact,
  type GatewayUiStatus,
} from "@/lib/api";
// Recovery is owned by useAppSync (wraps useGatewayRecovery). Keep the
// import path discoverable for phase3 wiring tests via use-app-sync.
import { useAppSync } from "@/hooks/use-app-sync";
import { useTaskSubmission } from "@/hooks/use-task-submission";
import {
  buildTakeawaysContent,
  buildWeeklyRecap,
  isActiveTaskStatus,
  projectWaitingOnYou,
  waitingOnYouTaskIds,
  type UsageSnapshot,
} from "@grokdesk/shared";
import { buildChats, chatTitle, findChat } from "@/lib/chats";
import {
  AppSidebar,
  type NavId,
} from "@/components/shell/app-sidebar";
import { AppTopbar } from "@/components/shell/app-topbar";
import { HomeView } from "@/components/views/home-view";
import { TasksView } from "@/components/views/tasks-view";
import { TaskWorkspaceView } from "@/components/views/task-workspace-view";
import {
  projectDesktopReadiness,
  readinessInputFromAppState,
} from "@/lib/readiness-ui";
import {
  isAccountSignedIn,
  readinessSignInFlags,
} from "@/lib/account-signed-in";
import { FolderTrustPrompt } from "@/components/folder-trust-prompt";
import {
  dismissFolderTrustPrompt,
  shouldShowFolderTrustPrompt,
  trustFolder,
  untrustFolder,
} from "@/lib/folder-trust-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useOwnedConfirm } from "@/hooks/use-owned-confirm";
import { withViewTransition } from "@/lib/view-transition";
import { MOTION_SURFACE_CLASSES } from "@/lib/motion-system";
import { buildGreeting } from "@/lib/greeting";
import { useI18n, useT } from "@/i18n";
import { useInbox } from "@/hooks/use-inbox";
import type {
  Artifact,
  AuthState,
  EffortLevel,
  MemoryItem,
  RolePack,
  ScheduleRule,
  SessionSearchView,
  Task,
  TaskEvent,
} from "@grokdesk/shared";
import {
  findPack,
  packEffortIfUnset,
  readLastRolePackId,
  resolveCreateRolePack,
  writeLastRolePackId,
} from "@/lib/role-packs";
import {
  migrateLegacyOnboardingDismissed,
  shouldShowOnboarding,
} from "@/lib/onboarding";
import {
  readLastWorkspaceRoot,
  resolveInitialWorkspaceRoot,
  writeLastWorkspaceRoot,
} from "@/lib/workspace-memory";
import {
  findPendingApproval,
  newestNonTerminalTaskId,
} from "@/lib/pending-approval";
import { BrandMark } from "@/components/brand-mark";
import { BootScreen } from "@/components/boot-screen";
import type { BootStage } from "@/lib/boot-progress";
import { NoticeSlot } from "@/components/notice-slot";
import {
  SecurityUpdateBanner,
  shouldShowSecurityUpdateBanner,
} from "@/components/security-update-banner";
import {
  UpdateRestartDialog,
  shouldShowUpdateRestartDialog,
} from "@/components/update-restart-dialog";
import { humanizeError } from "@/lib/errors";
import { useChatEvents } from "@/hooks/use-chat-events";
import { useUpdateStatus } from "@/hooks/use-update-status";
import { useConversationOutbox } from "@/hooks/use-conversation-outbox";
import { migrateLocalQueueToOutbox } from "@/lib/outbox-migration";
import {
  beginMutation,
  clearPendingMutation,
  newClientMutationId,
  readPendingMutation,
} from "@/lib/client-mutation";
import {
  buildOutboxFollowUpParams,
  FOLLOW_UP_OUTBOX_METHOD,
} from "@/lib/outbox-follow-up";
import type { OutboxEnqueueResult } from "@grokdesk/shared";
import { GROKDESK_REMOTE_UI_ENABLED } from "@grokdesk/shared";
import {
  resolveSettingsTab,
  type SettingsTabId,
} from "@/lib/settings-tab";
import {
  buildCreateTaskParams,
  buildOptimisticTask,
  canFollowUpOnTask,
  dropOptimisticTasks,
  mergeCreatedTask,
} from "@/lib/create-task-optimistic";
import {
  buildTaskStatusMap,
  listNewlyFinishedTasks,
  mergeServerTasksWithOptimistic,
  remapSelectedTaskId,
} from "@/lib/task-list-sync";
import {
  isTypingTarget,
  resolveAppShortcut,
} from "@/lib/app-shortcuts";
import {
  isPinned,
  loadPinStore,
  prunePins,
  savePinStore,
  sortChatsWithPins,
  togglePin,
} from "@/lib/pinned-chats";
import { prepareCopyLastResponse } from "@/lib/copy-last-response";
import {
  emptyWorkSession,
  loadWorkSession,
  saveWorkSession,
  touchWorkSession,
} from "@/lib/work-session";
import {
  planHomeDraftHydration,
  shouldBlockNewRootSubmit,
} from "@/lib/home-draft-hydrate";
import { attachmentsFromQueuedPaths } from "@/lib/message-queue";
import { buildShellNotices } from "@/lib/shell-notices";
import { topbarSearchPlaceholder } from "@/lib/topbar-search";
import { resolveModelAfterAuth } from "@/lib/auth-sign-in-poll";
import {
  createAccountController,
  type AccountController,
} from "@/lib/account-controller";
import {
  shouldShowReauthBanner,
  shouldShowSignInInvite,
  type AccountSnapshot,
} from "@/lib/account-state";
import {
  openTaskListState,
  openTaskWorkspaceState,
  shouldClearSelectionOnDelete,
  shouldSkipCancel,
} from "@/lib/task-navigation";
import {
  ONBOARDING_DISMISSED_KEY,
  onboardingSettingsPayload,
  seedStarterGoal,
} from "@/lib/onboarding-complete";
import {
  navChangeSideEffects,
  newChatNavState,
} from "@/lib/nav-transition";
import {
  createFailedNavState,
  makeOptimisticTaskId,
  optimisticCreateNavState,
  shouldBlockCreate,
} from "@/lib/create-task-ui";
import {
  greetingNameFromAuth,
  greetingStatsFromLists,
} from "@/lib/greeting-stats";
import { appSettingsFromSettingsGet } from "@/lib/app-settings-slice";
import { selectedChatKey as buildSelectedChatKey } from "@/lib/selected-chat-key";
import {
  anyLiveTasks,
  navigateTargetIntent,
} from "@/lib/navigate-target";
import { approvalModeFromSettings } from "@/lib/approval-mode-settings";
import {
  primaryRootsFromTasks,
  tasksHaveWorkspaceRoot,
} from "@/lib/task-primary-roots";
import {
  shouldReuseLocalEventsForTakeaways,
  takeawaysMemoryUpsert,
} from "@/lib/takeaways-memory";
import type { ComposerIntentId } from "@/lib/composer-intents";
import {
  approveMemorySuggestion,
  dismissMemorySuggestion,
  editMemorySuggestion,
  loadMemorySuggestionStore,
  pendingMemorySuggestions,
  saveMemorySuggestionStore,
  suggestionToMemoryUpsert,
  type MemorySuggestionStore,
} from "@/lib/memory-suggestions";
import {
  filterMemoriesBySearch,
  filterSchedulesBySearch,
} from "@/lib/list-search-filter";
import {
  imagineFromTaskNavState,
  scheduleFromTaskNavState,
} from "@/lib/imagine-schedule-nav";
import { scheduleCreateParams } from "@/lib/schedule-create-params";
import { appSettingsAfterSave } from "@/lib/settings-saved-slice";
import { threadTasksForWorkspace } from "@/lib/thread-tasks";
import { needsYouItemsFromWaiting } from "@/lib/inbox-needs-you";
import {
  chatContainsSelectedTurn,
  cleanChatTitle,
} from "@/lib/chat-title";
import { usageChipFromSnapshot } from "@/lib/usage-chip";

import {
  openAccountSettingsNavState,
  openSettingsNavState,
  openToolsNavState,
} from "@/lib/open-settings-nav";
import { dualSearchValue, topbarSearchValue } from "@/lib/dual-search";
import {
  shouldShowTopbarSearch,
  shouldShowViewLocalSearch,
} from "@/lib/view-search-policy";
import {
  finishNotificationIntents,
  shouldFireFinishNotifications,
} from "@/lib/task-finish-notify";
import { openDocsWindow } from "@/lib/docs-url";
import { isBusyTaskStatus, isTerminalTaskStatus } from "@/lib/task-terminal";
import { inboxWorkspaceRoots } from "@/lib/inbox-workspace-roots";
import { buildCreateTaskForm } from "@/lib/create-task-form";
import {
  signedInSuccessToast,
  signedOutAuthState,
  signOutResultToast,
} from "@/lib/sign-in-toast";
import {
  loadMilestones,
  patchMilestones,
  saveMilestones,
  type ActivationMilestones,
} from "@/lib/activation-milestones";

// Lazy rarely-hit / heavy views (R3). Names kept for ui-structure.test.ts.
const ScheduledView = lazy(() =>
  import("@/components/views/scheduled-view").then((m) => ({
    default: m.ScheduledView,
  })),
);
const ArtifactsView = lazy(() =>
  import("@/components/views/artifacts-view").then((m) => ({
    default: m.ArtifactsView,
  })),
);
const MemoryView = lazy(() =>
  import("@/components/views/memory-view").then((m) => ({
    default: m.MemoryView,
  })),
);
const SettingsView = lazy(() =>
  import("@/components/views/settings-view").then((m) => ({
    default: m.SettingsView,
  })),
);
const OnboardingWizard = lazy(() =>
  import("@/components/onboarding-wizard").then((m) => ({
    default: m.OnboardingWizard,
  })),
);
const CommandPalette = lazy(() =>
  import("@/components/command-palette").then((m) => ({
    default: m.CommandPalette,
  })),
);
const ShortcutsHelp = lazy(() =>
  import("@/components/shortcuts-help").then((m) => ({
    default: m.ShortcutsHelp,
  })),
);
const InboxPanel = lazy(() =>
  import("@/components/inbox-panel").then((m) => ({
    default: m.InboxPanel,
  })),
);
const RemoteControlBanner = lazy(() =>
  import("@/components/remote-control-banner").then((m) => ({
    default: m.RemoteControlBanner,
  })),
);

function ViewFallback() {
  return (
    <div
      className="flex flex-1 items-center justify-center p-8"
      role="status"
      aria-live="polite"
      data-testid="view-lazy-fallback"
    >
      <Skeleton className="h-24 w-full max-w-md rounded-xl" />
    </div>
  );
}

type TaskFilter = "all" | "running" | "scheduled" | "done" | "failed";
type TaskSurface = "list" | "workspace";

export function App() {
  const { toast } = useToast();
  const t = useT();
  const ownedConfirm = useOwnedConfirm();
  const { locale } = useI18n();
  const updateStatus = useUpdateStatus();
  const [nav, setNav] = useState<NavId>("home");
  const [auth, setAuth] = useState<(AuthState & { models?: string[] }) | null>(
    null,
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskSurface, setTaskSurface] = useState<TaskSurface>("list");

  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRule[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [models, setModels] = useState<string[]>(["grok-4.5"]);
  const [appSettings, setAppSettings] = useState<{
    mcpServers: Array<{
      id: string;
      command: string;
      args: string[];
      env?: Record<string, string>;
      enabled: boolean;
    }>;
    skillsPaths: string[];
    effectiveSkillsPaths?: string[];
    preferProviderEngine: boolean;
    inheritUserGrok: boolean;
    trustedFolders: string[];
  }>({
    mcpServers: [],
    skillsPaths: [],
    effectiveSkillsPaths: [],
    preferProviderEngine: false,
    inheritUserGrok: false,
    trustedFolders: [],
  });
  /** Bumps when user dismisses folder-trust prompt (session-only). */
  const [folderTrustUiTick, setFolderTrustUiTick] = useState(0);

  /**
   * Task 12: hydrate Home draft / pending mutation before composer interactive.
   * Pure planHomeDraftHydration - no toast in initializer.
   */
  const initialHomeHydration = useMemo(() => {
    try {
      return planHomeDraftHydration({
        session: loadWorkSession(),
        pendingMutation: readPendingMutation(),
        lastWorkspaceRoot: readLastWorkspaceRoot(),
      });
    } catch {
      return planHomeDraftHydration({ session: emptyWorkSession() });
    }
  }, []);

  const [goal, setGoal] = useState(() => initialHomeHydration.goal);
  /** One-shot "Draft restored" after boot hydrate (Task 12). */
  const [draftRestoredNotice, setDraftRestoredNotice] = useState(
    () => initialHomeHydration.showDraftRestored,
  );
  /** Phase 3 structured composer intent (chip mode; expanded at send). */
  const [composerIntentId, setComposerIntentId] =
    useState<ComposerIntentId | null>(null);
  /**
   * Draft goal for Scheduled create form (Schedule intent / workspace handoff).
   * Separate from Home composer so opening Schedules from nav does not leak.
   */
  const [scheduleDraftGoal, setScheduleDraftGoal] = useState<string | null>(
    null,
  );
  const [memorySuggestionStore, setMemorySuggestionStore] =
    useState<MemorySuggestionStore>(() => loadMemorySuggestionStore());
  const [root, setRoot] = useState(() => {
    // Prefer hydrated session root; never seed with an app-managed generated folder.
    return (
      initialHomeHydration.root?.trim() ||
      readLastWorkspaceRoot() ||
      ""
    );
  });
  const [homeAttachments, setHomeAttachments] = useState<
    import("@grokdesk/shared").TaskAttachment[]
  >(
    () =>
      attachmentsFromQueuedPaths(initialHomeHydration.attachmentPaths) ?? [],
  );
  const [model, setModel] = useState("grok-4.5");
  const [effort, setEffort] = useState<EffortLevel>("normal");
  const [planFirst, setPlanFirst] = useState(false);
  const [rolePacks, setRolePacks] = useState<RolePack[]>([]);
  const [rolePackId, setRolePackId] = useState<string | null>(() =>
    readLastRolePackId(),
  );
  const [approvalMode, setApprovalMode] = useState<
    "strict" | "balanced" | "autopilot"
  >("balanced");
  const [starting, setStarting] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootStage, setBootStage] = useState<BootStage>("starting");
  // Optimistic first-launch until settings prove completed; never flash main shell first.
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [gatewayUiStatus, setGatewayUiStatus] =
    useState<GatewayUiStatus>("ready");
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("account");
  const [search, setSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [usageSnap, setUsageSnap] = useState<UsageSnapshot | null>(null);
  const [accountSnap, setAccountSnap] = useState<AccountSnapshot | null>(null);
  const [activation, setActivation] = useState<ActivationMilestones>(() =>
    loadMilestones(),
  );
  const [focusComposerToken, setFocusComposerToken] = useState(0);
  const accountCtrlRef = useRef<AccountController | null>(null);

  const updateActivation = useCallback((patch: Partial<ActivationMilestones>) => {
    setActivation((prev) => {
      const next = patchMilestones(prev, patch);
      saveMilestones(next);
      return next;
    });
  }, []);

  if (!accountCtrlRef.current) {
    accountCtrlRef.current = createAccountController({
      signIn: async () => {
        const res = await rpc<{ ok: boolean; message: string }>(
          "auth.signIn",
          {},
        );
        return { ok: Boolean(res.ok), message: res.message };
      },
      signOut: async () => {
        const res = await rpc<{
          ok: boolean;
          signedOut?: boolean;
          message?: string;
        }>("auth.signOut", {});
        return {
          ok: Boolean(res.ok),
          signedOut: res.signedOut,
          message: res.message,
        };
      },
      status: async () => {
        const s = await rpc<AuthState & { models?: string[] }>(
          "auth.status",
          {},
        );
        return {
          signedIn: Boolean(s.signedIn),
          needsReauth: Boolean(s.needsReauth),
          accountLabel: s.accountLabel,
          accountName: s.accountName,
          engineStatus: s.engineStatus,
          models: s.models,
        };
      },
      getUsage: async (force) => getUsage(Boolean(force)),
      pauseAllTasks: async () => {
        await rpc("tasks.pauseAll", {});
      },
    });
  }

  const setWorkspaceRoot = useCallback((path: string) => {
    const next = (path ?? "").trim();
    setRoot(next);
    writeLastWorkspaceRoot(next || null);
    // Auto-trust user-chosen project folders so Desk skills install into the
    // project and image/marketing workflows can use project context without a
    // separate Settings step (still reversible via Preferences → Trusted folders).
    if (next) {
      setAppSettings((s) => {
        const trusted = trustFolder(s.trustedFolders ?? [], next);
        if (trusted === s.trustedFolders) return s;
        void rpc("settings.set", { trustedFolders: trusted }).catch(() => {
          /* non-blocking */
        });
        return { ...s, trustedFolders: trusted };
      });
    }
  }, []);
  const inbox = useInbox(30_000);
  // Live-activity flag drives adaptive polling; status map powers the events
  // poll shutdown and background completion notifications.
  const hasLiveRef = useRef(false);
  const taskStatusRef = useRef<Map<string, string>>(new Map());

  const greeting = useMemo(() => {
    const stats = greetingStatsFromLists(tasks, schedules, isActiveTaskStatus);
    return buildGreeting({
      name: greetingNameFromAuth(auth),
      now: new Date(),
      total: stats.total,
      running: stats.running,
      done: stats.done,
      artifacts: artifacts.length,
      schedules: stats.enabledSchedules,
    });
  }, [auth, tasks, artifacts, schedules, locale, t]);

  const refreshAuth = useCallback(async () => {
    const ctrl = accountCtrlRef.current;
    if (!ctrl) return;
    const snap = await ctrl.refreshStatus();
    setAccountSnap(snap);
    const s = await rpc<AuthState & { models?: string[] }>("auth.status", {});
    // Map controller phase onto AuthState for existing surfaces.
    setAuth({
      ...s,
      signedIn: snap.phase === "signed_in",
      needsReauth: shouldShowReauthBanner(snap.phase),
      accountLabel:
        snap.identity.accountLabel ??
        (snap.phase === "signed_in" ? s.accountLabel : null),
      accountName:
        snap.identity.accountName ??
        (snap.phase === "signed_in" ? s.accountName : null),
    });
    if (s.models?.length && snap.phase === "signed_in") {
      setModels(s.models);
      setModel((prev) => resolveModelAfterAuth(prev, s.models));
    }
    try {
      const catalog = await rpc<{ models?: string[]; defaultModel?: string }>(
        "models.list",
        {},
      );
      if (catalog.models?.length) {
        setModels(catalog.models);
        setModel((prev) => resolveModelAfterAuth(prev, catalog.models));
      }
    } catch {
      /* auth models remain */
    }
    if (snap.phase === "signed_out" || snap.phase === "reauth_required") {
      setUsageSnap(null);
    } else {
      const u = ctrl.getUsageSnapshot();
      if (u) setUsageSnap(u);
    }
  }, []);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const refreshTasks = useCallback(async () => {
    const server = await rpc<Task[]>("tasks.list", {});
    // Keep any not-yet-reconciled optimistic tasks so a background poll can't
    // yank the workspace out from under a task that's still being created.
    // Remap selection when optimistic-* is replaced by the real task id
    // (notify.tasksChanged often races createTask and used to leave a ghost selection).
    setTasks((prev) => {
      const next = mergeServerTasksWithOptimistic(prev, server);
      const sel = selectedIdRef.current;
      const remapped = remapSelectedTaskId(sel, prev, next);
      if (remapped !== sel) {
        queueMicrotask(() => setSelectedId(remapped));
      }
      return next;
    });
  }, []);

  const refreshSide = useCallback(async () => {
    const [sc, mem, arts, settings] = await Promise.all([
      rpc<ScheduleRule[]>("schedule.list", {}),
      rpc<MemoryItem[]>("memory.list", {}),
      rpc<Artifact[]>("artifacts.list", {}),
      rpc<{
        mcpServers?: Array<{
          id: string;
          command: string;
          args: string[];
          enabled: boolean;
        }>;
        skillsPaths?: string[];
        effectiveSkillsPaths?: string[];
      }>("settings.get", {}),
    ]);
    setSchedules(sc);
    setMemories(mem);
    setArtifacts(arts);
    setAppSettings(appSettingsFromSettingsGet(settings));
  }, []);

  // Tray / deep-link style navigation (e.g. Remote access…)
  useEffect(() => {
    return subscribeNavigate((target) => {
      withViewTransition(() => {
        const intent = navigateTargetIntent(target);
        if (intent.type === "settings") {
          setNav("settings");
          if (intent.settingsTab) {
            setSettingsTab(resolveSettingsTab(intent.settingsTab));
          }
        } else if (intent.type === "nav") {
          setNav(intent.nav);
        }
      });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ctrl = accountCtrlRef.current;
    ctrl?.dispatch({ type: "boot_started" });
    setAccountSnap(ctrl?.getSnapshot() ?? null);

    // Shell/onboarding render from local settings immediately - never block
    // first paint on slow `grok models` / auth.status probes.
    (async () => {
      setBootStage("loading_workspace");
      try {
        const [settings, taskList] = await Promise.all([
          rpc<{
            onboardingCompleted?: boolean;
            defaultApprovalMode?: "strict" | "balanced" | "autopilot";
            preferProviderEngine?: boolean;
            mcpServers?: Array<{
              id: string;
              command: string;
              args: string[];
              enabled: boolean;
            }>;
            skillsPaths?: string[];
            effectiveSkillsPaths?: string[];
          }>("settings.get", {}),
          rpc<Task[]>("tasks.list", {}).catch(() => [] as Task[]),
          refreshSide().catch(() => {}),
          rpc<RolePack[]>("rolePacks.list", {})
            .then((packs) => {
              if (!cancelled) setRolePacks(packs);
            })
            .catch(() => {
              /* packs optional at boot */
            }),
        ]);

        if (cancelled) return;

        setBootStage("restoring_session");

        setTasks(taskList);
        // F5: seed live flag before the first adaptive poll tick.
        hasLiveRef.current = anyLiveTasks(taskList, isActiveTaskStatus);
        taskStatusRef.current = buildTaskStatusMap(taskList);
        setAppSettings(appSettingsFromSettingsGet(settings));
        // Restore last *user* folder by default - never a generated workspace path.
        setRoot((prev) => {
          const resolved = resolveInitialWorkspaceRoot({
            explicit: prev,
            lastUsed: readLastWorkspaceRoot(),
            taskRoots: primaryRootsFromTasks(taskList),
          });
          if (resolved) writeLastWorkspaceRoot(resolved);
          else writeLastWorkspaceRoot(null);
          return resolved;
        });
        {
          const mode = approvalModeFromSettings(settings.defaultApprovalMode);
          if (mode) setApprovalMode(mode);
        }

        let onboardingCompleted = Boolean(settings.onboardingCompleted);
        // Migrate Home checklist dismiss → settings flag once.
        let legacyDismissed = false;
        try {
          legacyDismissed =
            localStorage.getItem("grokdesk.onboarding.dismissed") === "1";
        } catch {
          /* ignore */
        }
        const hasRootFromHistory = tasksHaveWorkspaceRoot(taskList);
        // Defer signedIn for migration until background auth finishes; use local flag.
        if (
          !onboardingCompleted &&
          migrateLegacyOnboardingDismissed({
            legacyDismissed,
            signedIn: false,
            hasWorkspaceRoot: hasRootFromHistory,
          })
        ) {
          try {
            await rpc("settings.set", { onboardingCompleted: true });
            onboardingCompleted = true;
          } catch {
            /* non-fatal; wizard may show again */
          }
        }
        setShowOnboarding(shouldShowOnboarding({ onboardingCompleted }));
      } catch (e) {
        if (!cancelled) {
          toast({ description: humanizeError(e, t), variant: "destructive" });
          // Boot errors show the gateway-dead banner over the normal shell.
          // Only force the wizard when settings definitively say incomplete
          // (we never got a settings payload here, so keep the shell).
          setShowOnboarding(false);
        }
      } finally {
        if (!cancelled) {
          setBootStage("ready");
          // Let the real 100% milestone paint before handing off to the shell.
          await new Promise((resolve) => window.setTimeout(resolve, 160));
          if (!cancelled) setBooting(false);
        }
      }

      // Background account verification - updates shell when ready.
      if (!cancelled) {
        void refreshAuth().catch(() => {});
        void accountCtrlRef.current?.refreshUsage(false).then((u) => {
          if (!cancelled && u) setUsageSnap(u);
        });
      }
    })();
    // Prefer gateway notify.tasksChanged; keep a 30s safety-net poll.
    // Do NOT poll auth.status every 30s (expensive grok models probe).
    const unsubNotify = subscribeGatewayNotify((msg) => {
      if (msg.method === "notify.tasksChanged") {
        void refreshTasks().catch(() => {});
        void refreshSide().catch(() => {});
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = () => {
      if (cancelled) return;
      // Safety net only; push handles live updates.
      const delay = 30_000;
      timer = setTimeout(async () => {
        await Promise.all([
          refreshTasks().catch(() => {}),
          refreshSide().catch(() => {}),
        ]);
        loop();
      }, delay);
    };
    loop();

    // Refresh auth on focus with a minimum interval (not a 30s hammer).
    let lastAuthFocus = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastAuthFocus < 60_000) return;
      lastAuthFocus = now;
      void refreshAuth().catch(() => {});
    };
    window.addEventListener("focus", onFocus);

    const unsubAccount = accountCtrlRef.current?.subscribe(() => {
      const snap = accountCtrlRef.current?.getSnapshot() ?? null;
      setAccountSnap(snap);
      const u = accountCtrlRef.current?.getUsageSnapshot() ?? null;
      setUsageSnap(u);
      // Keep auth.signedIn aligned with AccountController so Sidebar/Settings
      // never lag behind a resolved phase (startSignIn / refreshStatus emit).
      if (
        snap &&
        snap.phase !== "checking" &&
        snap.phase !== "signing_in"
      ) {
        setAuth((prev) => {
          const nextSignedIn = snap.phase === "signed_in";
          if (!prev && !nextSignedIn) return prev;
          return {
            ...(prev ?? {
              signedIn: false,
              needsReauth: false,
              accountLabel: null,
              accountName: null,
              engineStatus: "unknown" as const,
            }),
            signedIn: nextSignedIn,
            needsReauth: shouldShowReauthBanner(snap.phase),
            accountLabel:
              snap.identity.accountLabel ??
              (nextSignedIn ? prev?.accountLabel ?? null : null),
            accountName:
              snap.identity.accountName ??
              (nextSignedIn ? prev?.accountName ?? null : null),
          };
        });
      }
    });

    return () => {
      cancelled = true;
      unsubNotify();
      unsubAccount?.();
      window.removeEventListener("focus", onFocus);
      if (timer) clearTimeout(timer);
    };
  }, [refreshAuth, refreshTasks, refreshSide, toast, t]);

  // Gateway lifecycle banner (reconnect / dead after child crash).
  useEffect(() => {
    let cancelled = false;
    void getGatewayStatus().then((s) => {
      if (!cancelled) setGatewayUiStatus(s);
    });
    const unsub = subscribeGatewayStatus((s) => setGatewayUiStatus(s));
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // When landing on Home, park the caret in compose so the next idea is one keystroke away.
  useEffect(() => {
    if (booting || showOnboarding || nav !== "home") return;
    setFocusComposerToken((n) => n + 1);
  }, [nav, booting, showOnboarding]);

  // Canonical signed-in: AccountController phase wins when resolved so Home,
  // Sidebar, Settings, and palette never disagree (and boot "checking" does
  // not flash a false Sign-in blocker).
  const signedIn = useMemo(
    () =>
      isAccountSignedIn({
        accountPhase: accountSnap?.phase,
        authSignedIn: auth?.signedIn,
      }),
    [accountSnap?.phase, auth?.signedIn],
  );

  const effectiveAuth = useMemo((): (AuthState & { models?: string[] }) | null => {
    if (!auth && !signedIn && !accountSnap) return null;
    const base: AuthState & { models?: string[] } = auth ?? {
      signedIn: false,
      needsReauth: false,
      accountLabel: null,
      accountName: null,
      engineStatus: "unknown",
    };
    return {
      ...base,
      signedIn,
      needsReauth:
        shouldShowReauthBanner(accountSnap?.phase ?? "signed_out") ||
        Boolean(auth?.needsReauth),
      accountLabel:
        accountSnap?.identity.accountLabel ?? auth?.accountLabel ?? null,
      accountName:
        accountSnap?.identity.accountName ?? auth?.accountName ?? null,
    };
  }, [auth, signedIn, accountSnap]);

  const shellReadinessInput = useMemo(() => {
    const flags = readinessSignInFlags({
      accountPhase: accountSnap?.phase,
      authSignedIn: auth?.signedIn,
    });
    // Free Desk: no product-license dimension; runtime, sign-in, workspace only.
    return readinessInputFromAppState({
      runtimeReady: auth?.engineStatus !== "missing",
      signedIn: flags.signedIn,
      neverSignedIn: flags.neverSignedIn,
      signInRequired: flags.signInRequired,
      workspaceSelected: Boolean(root?.trim()),
    });
  }, [
    accountSnap?.phase,
    auth?.signedIn,
    auth?.engineStatus,
    root,
  ]);

  // Soft usage chip on Home when SuperGrok period usage is elevated.
  useEffect(() => {
    if (!signedIn) {
      setUsageSnap(null);
      return;
    }
    let cancelled = false;
    void getUsage(false)
      .then((u) => {
        if (!cancelled) setUsageSnap(u);
      })
      .catch(() => {
        if (!cancelled) setUsageSnap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  // Group tasks into chats (a root + its follow-up turns). The sidebar shows
  // one row per chat; the workspace shows a chat's whole turn history.
  const [pinStore, setPinStore] = useState(() => loadPinStore());
  const chats = useMemo(() => {
    const built = buildChats(tasks);
    return sortChatsWithPins(built, pinStore);
  }, [tasks, pinStore]);
  const selectedChat = useMemo(
    () => findChat(chats, selectedId),
    [chats, selectedId],
  );

  useEffect(() => {
    const built = buildChats(tasks);
    const pruned = prunePins(pinStore, new Set(built.map((c) => c.id)));
    if (pruned.ids.join("\0") !== pinStore.ids.join("\0")) {
      setPinStore(pruned);
      savePinStore(pruned);
    }
  }, [tasks, pinStore]);

  const togglePinChat = useCallback(
    (chatId: string | null | undefined) => {
      if (!chatId) return;
      setPinStore((prev) => {
        const next = togglePin(prev, chatId);
        savePinStore(next);
        const pinnedNow = isPinned(next, chatId);
        toast({
          description: pinnedNow
            ? t("workspace.chatPinned")
            : t("workspace.chatUnpinned"),
        });
        return next;
      });
    },
    [toast, t],
  );

  // The active turn of the open chat: target for approvals, cancel, follow-ups.
  const workspaceTask = selectedChat?.latest ?? selected;
  const workspaceThreadTasks = useMemo(
    () =>
      workspaceTask
        ? threadTasksForWorkspace({
            rootId: selectedChat?.id ?? workspaceTask.id,
            turns: selectedChat?.turns ?? [workspaceTask],
            allTasks: tasks,
          })
        : [],
    [selectedChat, tasks, workspaceTask],
  );
  // Stable key that only changes when the set of turns changes (not per poll),
  // so the events effect doesn't re-run on every status tick.
  const selectedChatKey = useMemo(
    () =>
      `${buildSelectedChatKey(selectedChat, selectedId)}:${workspaceThreadTasks
        .map((threadTask) => threadTask.id)
        .sort()
        .join(",")}`,
    [selectedChat, selectedId, workspaceThreadTasks],
  );

  const [eventsResyncKey, setEventsResyncKey] = useState(0);
  const {
    events,
    eventsByTask,
    loading: eventsLoading,
    error: eventsError,
    staleSince: eventsStaleSince,
    truncated: eventsTruncated,
    retry: retryChatEvents,
  } = useChatEvents({
    taskSurface,
    selectedChatKey,
    chatId: selectedChat?.id ?? selectedId ?? "",
    turns: workspaceThreadTasks,
    taskStatusRef,
    resyncKey: eventsResyncKey,
  });

  const copyLastResponse = useCallback(async () => {
    const msgs = events
      .filter((e) => {
        const kind = String(
          (e as { kind?: string }).kind ?? (e as { type?: string }).type ?? "",
        );
        return (
          kind.includes("message") ||
          kind === "assistant" ||
          kind === "text" ||
          Boolean((e as { text?: string }).text)
        );
      })
      .map((e) => ({
        role:
          (e as { role?: string }).role ??
          String(
            (e as { kind?: string }).kind ??
              (e as { type?: string }).type ??
              "assistant",
          ),
        text:
          (e as { text?: string }).text ??
          (e as { message?: string }).message ??
          "",
      }));
    const prepared = prepareCopyLastResponse(msgs);
    if (!prepared.ok) {
      toast({ description: t("workspace.answerCopyEmpty") });
      return;
    }
    try {
      await navigator.clipboard.writeText(prepared.markdown);
      toast({ description: t("workspace.answerCopied") });
    } catch {
      toast({
        description: t("workspace.answerCopyEmpty"),
        variant: "destructive",
      });
    }
  }, [events, toast, t]);

  // Global shortcuts: power without a settings maze
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const intent = resolveAppShortcut({
        meta: e.metaKey || e.ctrlKey,
        shift: e.shiftKey,
        key: e.key,
        typing: isTypingTarget(e.target),
        paletteOpen,
        inboxOpen,
        shortcutsOpen,
        nav,
        taskSurface,
        showOnboarding,
        live: tasks.some((task) => isActiveTaskStatus(task.status)),
      });
      switch (intent.type) {
        case "new_chat":
          e.preventDefault();
          withViewTransition(() => {
            const next = newChatNavState();
            setNav(next.nav);
            setSelectedId(next.selectedId);
            setTaskSurface(next.taskSurface);
            setGoal(next.goal);
            setHomeAttachments([]);
            setFocusComposerToken((n) => n + 1);
          });
          return;
        case "stop_live": {
          e.preventDefault();
          const live =
            tasks.find(
              (t) => t.id === selectedId && isActiveTaskStatus(t.status),
            ) ?? tasks.find((t) => isActiveTaskStatus(t.status));
          if (live) void cancelTask(live.id);
          return;
        }
        case "close_palette":
          setPaletteOpen(false);
          return;
        case "close_shortcuts":
          setShortcutsOpen(false);
          return;
        case "close_inbox":
          setInboxOpen(false);
          return;
        case "workspace_to_list":
          e.preventDefault();
          withViewTransition(() => setTaskSurface("list"));
          return;
        case "focus_composer_slash":
          e.preventDefault();
          setFocusComposerToken((n) => n + 1);
          return;
        case "open_inbox":
          e.preventDefault();
          setInboxOpen(true);
          return;
        case "copy_last_response":
          e.preventDefault();
          void copyLastResponse();
          return;
        case "show_shortcuts":
          e.preventDefault();
          setPaletteOpen(false);
          setShortcutsOpen((v) => !v);
          return;
        case "toggle_pin_chat":
          e.preventDefault();
          togglePinChat(selectedChat?.id);
          return;
        case "nav":
          e.preventDefault();
          withViewTransition(() => {
            setNav(intent.nav);
            if (intent.nav !== "tasks") setTaskSurface("list");
          });
          return;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    tasks,
    selectedId,
    paletteOpen,
    inboxOpen,
    shortcutsOpen,
    nav,
    taskSurface,
    showOnboarding,
    copyLastResponse,
    togglePinChat,
    selectedChat?.id,
  ]);

  // Persist workspace session focus for resume-on-home.
  useEffect(() => {
    if (taskSurface !== "workspace" || !selectedChat) return;
    const prev = loadWorkSession();
    saveWorkSession(
      touchWorkSession(prev, {
        conversationId: selectedChat.id,
        surface: "workspace",
        draft: prev.surface === "workspace" ? prev.draft : prev.draft,
      }),
    );
  }, [taskSurface, selectedChat?.id]);

  // Track task status transitions: fire a background notification on completion
  // and keep the live-activity flag current for adaptive polling.
  useEffect(() => {
    const finished = listNewlyFinishedTasks(tasks, taskStatusRef.current);
    if (
      shouldFireFinishNotifications({
        finishedCount: finished.length,
        notificationAvailable: typeof Notification === "function",
        documentHasFocus: document.hasFocus(),
      })
    ) {
      for (const intent of finishNotificationIntents(finished)) {
        try {
          new Notification(t(intent.titleKey), { body: intent.body });
        } catch {
          // notifications unavailable (non-fatal)
        }
      }
    }
    taskStatusRef.current = buildTaskStatusMap(tasks);
    hasLiveRef.current = tasks.some((task) => isActiveTaskStatus(task.status));
  }, [tasks, t]);

  // Only the newest non-terminal turn can own the approval banner; a cancelled
  // turn's dangling approval_required must not resurface on follow-ups.
  const liveTurnId = useMemo(() => {
    const turns = selectedChat?.turns ?? (selected ? [selected] : []);
    return newestNonTerminalTaskId(turns);
  }, [selectedChat, selected]);

  const waitingOnYou = useMemo(
    () => projectWaitingOnYou({ tasks }),
    [tasks],
  );
  const weeklyRecap = useMemo(
    () =>
      buildWeeklyRecap({
        now: new Date(),
        memoryItems: memories.map((m) => ({
          id: m.id,
          title: m.title,
          content: m.content,
          updatedAt: m.updatedAt,
          kind: m.kind,
        })),
        completedTaskSummaries: tasks
          .filter((t) => t.status === "done" && t.completedAt)
          .map((t) => ({
            id: t.id,
            goal: t.goal,
            doneAt: t.completedAt as string,
          })),
      }),
    [memories, tasks],
  );
  const waitingOnYouTaskIdList = useMemo(
    () => waitingOnYouTaskIds(waitingOnYou),
    [waitingOnYou],
  );
  const needsYouItems = useMemo(
    () => needsYouItemsFromWaiting(waitingOnYou),
    [waitingOnYou],
  );

  const pendingApproval = useMemo(
    () => findPendingApproval(events, liveTurnId),
    [events, liveTurnId],
  );

  async function createTask(
    overrideGoal?: string,
    attachments?: import("@grokdesk/shared").TaskAttachment[],
    mediaStudio?: import("@grokdesk/shared").MediaStudioOptions | null,
  ) {
    // Task 12: do not start a duplicate root while a pending submit reconciles.
    if (shouldBlockNewRootSubmit(readPendingMutation())) {
      toast({
        description: t("home.pendingSubmitReconciling"),
        variant: "destructive",
      });
      return;
    }
    // Intent mode can expand an empty textarea into a full template goal.
    const block = shouldBlockCreate({
      starting,
      goal: overrideGoal ?? goal,
      hasComposerIntent: Boolean(composerIntentId),
      // Hard-block Run when managed Grok engine is missing  -  install first.
      runtimeReady: auth?.engineStatus !== "missing",
    });
    if (block === "starting") return;
    if (block === "empty_goal") {
      toast({ description: t("toast.describeGoal"), variant: "destructive" });
      return;
    }
    if (block === "runtime_missing") {
      toast({
        description: t("readiness.runtime.missing"),
        variant: "destructive",
      });
      withViewTransition(() => {
        setSettingsTab("advanced");
        setNav("settings");
      });
      return;
    }
    setStarting(true);
    const form = {
      ...buildCreateTaskForm({
        goal,
        overrideGoal,
        root,
        model,
        effort,
        approvalMode,
        planFirst,
        rolePackId,
        lastRolePackId: readLastRolePackId(),
        homeAttachments,
        attachments,
        rolePacks,
        resolveCreateRolePack,
        findPack,
        packEffortIfUnset: (e, packDefault) =>
          packEffortIfUnset(
            e as typeof effort,
            packDefault as typeof effort | undefined,
          ),
      }),
      intentId: composerIntentId,
      mediaStudio: mediaStudio ?? null,
    };

    const createParams = buildCreateTaskParams(form as never);
    // Schedule intent: open schedules with expanded goal draft (user confirms).
    if (createParams.sendAction === "open_schedule") {
      setStarting(false);
      const next = scheduleFromTaskNavState(createParams.goal);
      // Seed ScheduledView form (not the Home composer textarea).
      setScheduleDraftGoal(next.goal);
      setComposerIntentId(null);
      withViewTransition(() => setNav(next.nav));
      toast({ description: t("workspace.nextSchedule") });
      return;
    }

    // Capture intent into form, then clear chip so re-runs need a fresh pick.
    // Goal text stays until success so create failure can restore the composer.
    const intentAtSend = composerIntentId;
    setComposerIntentId(null);

    // Optimistic: jump straight into the workspace with a placeholder task so
    // Run feels instant, then reconcile with the real task from the gateway.
    const optimisticId = makeOptimisticTaskId();
    const optimistic = buildOptimisticTask({
      ...form,
      intentId: intentAtSend,
      id: optimisticId,
    } as never);
    const optNav = optimisticCreateNavState(optimisticId);
    withViewTransition(() => {
      setTasks((prev) => [optimistic, ...prev]);
      setSelectedId(optNav.selectedId);
      setTaskSurface(optNav.taskSurface);
      setNav(optNav.nav);
    });

    try {
      const createBody = buildCreateTaskParams(
        { ...form, intentId: intentAtSend } as never,
        optimisticId,
      );
      const pending = beginMutation({
        method: "tasks.create",
        payload: createBody as Record<string, unknown>,
        clientMutationId:
          typeof (createBody as { clientMutationId?: string }).clientMutationId ===
          "string"
            ? (createBody as { clientMutationId?: string }).clientMutationId
            : optimisticId,
      });
      const task = await rpc<Task>("tasks.create", {
        ...createBody,
        clientMutationId: pending.clientMutationId,
      });
      clearPendingMutation();
      // Clear Home draft only after authoritative acceptance (Task 12).
      saveWorkSession(
        touchWorkSession(loadWorkSession(), {
          draft: "",
          draftCleared: true,
          attachmentPaths: [],
          surface: "home",
        }),
      );
      writeLastRolePackId(form.rolePack);
      // Atomic replace: drop optimistic, select real id before any notify refresh.
      setTasks((prev) => mergeCreatedTask(prev, task));
      setSelectedId(task.id);
      setTaskSurface("workspace");
      setNav("tasks");
      setGoal("");
      setHomeAttachments([]);
      setDraftRestoredNotice(false);
      updateActivation({ firstRunCreated: true });
      // Refresh in background; remapSelectedTaskId keeps this real id selected.
      void refreshTasks().catch(() => {});
    } catch (e) {
      // Roll back the placeholder and return to the composer with the goal intact.
      setTasks((prev) => dropOptimisticTasks(prev));
      setComposerIntentId(intentAtSend);
      const failNav = createFailedNavState();
      setSelectedId(failNav.selectedId);
      withViewTransition(() => {
        setTaskSurface(failNav.taskSurface);
        setNav(failNav.nav);
      });
      toast({
        description: humanizeError(e, t),
        variant: "destructive",
        duration: 12000,
        action: {
          label: t("settings.openLogs"),
          onClick: () => {
            void openLogsFolder();
          },
        },
      });
    } finally {
      setStarting(false);
    }
  }

  function cancelSignIn() {
    accountCtrlRef.current?.cancelSignIn();
    setAccountSnap(accountCtrlRef.current?.getSnapshot() ?? null);
    toast({ description: t("account.signInCancelled") });
  }

  async function signIn() {
    const ctrl = accountCtrlRef.current;
    if (!ctrl) return;
    // Single visible, cancelable, deduplicated flow.
    toast({
      description: t("toast.completeLogin"),
      duration: 0,
      action: {
        label: t("common.cancel"),
        onClick: () => cancelSignIn(),
      },
    });
    setAccountSnap(ctrl.getSnapshot());
    const result = await ctrl.startSignIn();
    setAccountSnap(ctrl.getSnapshot());
    if (result.cancelled) return;
    if (result.ok) {
      await refreshAuth().catch(() => {});
      updateActivation({
        accountResolved: true,
        demoMode: false,
      });
      const done = signedInSuccessToast(result.accountLabel ?? null, (name) =>
        t("toast.signedInAs", { name }),
      );
      toast({
        description: done.description,
        variant: done.variant,
      });
      return;
    }
    toast({
      description: t("toast.loginPending"),
      action: {
        label: t("common.cancel"),
        onClick: () => cancelSignIn(),
      },
    });
  }

  /**
   * Sign out SuperGrok on this Mac (shared CLI session).
   * Confirms when tasks are active; clears identity, usage, models atomically.
   */
  async function signOut() {
    const ctrl = accountCtrlRef.current;
    if (!ctrl) return;
    const activeCount = tasks.filter((t) => isActiveTaskStatus(t.status)).length;
    if (activeCount > 0) {
      const ok = await ownedConfirm.ask({
        title: t("nav.signOut"),
        description: t("account.signOutConfirmActiveTasks"),
        destructive: true,
      });
      if (!ok) return;
    } else {
      const ok = await ownedConfirm.ask({
        title: t("nav.signOut"),
        description: t("account.signOutConfirmSharedCli"),
      });
      if (!ok) return;
    }

    // Optimistic UI - do not wait on CLI before flipping the shell.
    setAuth(signedOutAuthState());
    setUsageSnap(null);
    setAccountSnap(ctrl.getSnapshot());

    try {
      const res = await ctrl.startSignOut({
        activeTaskCount: activeCount,
        confirmed: true,
      });
      setAccountSnap(ctrl.getSnapshot());
      setUsageSnap(null);
      setAuth(signedOutAuthState());
      const out = signOutResultToast(
        { ok: res.ok, signedOut: res.ok },
        {
          signedOut: t("toast.signedOut"),
          failed: t("toast.signOutFailed"),
        },
      );
      toast({ description: out.description, variant: out.variant });
      if (!res.ok) {
        await refreshAuth().catch(() => {});
      }
    } catch (e) {
      setAuth(signedOutAuthState());
      setUsageSnap(null);
      toast({
        description: humanizeError(e, t) || t("toast.signOutFailed"),
        variant: "destructive",
      });
    }
  }

  const [focusApprovalId, setFocusApprovalId] = useState<string | null>(null);

  function openTaskWorkspace(
    id: string,
    opts?: { approvalId?: string | null },
  ) {
    withViewTransition(() => {
      const next = openTaskWorkspaceState(id, opts);
      setSelectedId(next.selectedId);
      setTaskSurface(next.taskSurface);
      setNav(next.nav as typeof nav);
      // I10: deep-link to exact approval when provided.
      setFocusApprovalId(next.focusApprovalId);
    });
  }

  function openTaskList(id?: string) {
    withViewTransition(() => {
      const next = openTaskListState(id, selectedId);
      setSelectedId(next.selectedId);
      setTaskSurface(next.taskSurface);
      setNav(next.nav as typeof nav);
    });
  }

  async function cancelTask(id: string) {
    if (shouldSkipCancel(id)) return;
    try {
      await rpc("tasks.cancel", { taskId: id });
      await refreshTasks();
      toast({ description: t("toast.taskStopped") });
    } catch (e) {
      toast({ description: humanizeError(e, t), variant: "destructive" });
    }
  }

  async function renameChat(rootId: string, title: string) {
    const clean = cleanChatTitle(title);
    if (!clean) return;
    try {
      await renameTask(rootId, clean);
      await refreshTasks();
    } catch (e) {
      toast({ description: humanizeError(e, t), variant: "destructive" });
    }
  }

  async function resetChatTitle(rootId: string) {
    try {
      await rpc("tasks.setTitle", { taskId: rootId, resetToAuto: true });
      await refreshTasks();
    } catch (e) {
      toast({ description: humanizeError(e, t), variant: "destructive" });
    }
  }

  async function removeChat(rootId: string) {
    const chat = chats.find((c) => c.id === rootId);
    const wasSelected = chatContainsSelectedTurn(chat?.turns, selectedId);
    try {
      await deleteTask(rootId);
      if (shouldClearSelectionOnDelete(wasSelected)) {
        withViewTransition(() => {
          setSelectedId(null);
          setTaskSurface("list");
        });
      }
      await refreshTasks();
      toast({ description: t("toast.chatDeleted") });
    } catch (e) {
      toast({ description: humanizeError(e, t), variant: "destructive" });
    }
  }

  const queueUndoRef = useRef<(id?: string) => void>(() => {});
  const queuePurgeUndoRef = useRef<(id?: string) => void>(() => {});
  const workspaceQueue = useConversationOutbox({
    conversationId: selectedChat?.id ?? workspaceTask?.id,
    parentTaskId: workspaceTask?.id ?? selectedChat?.id ?? null,
    taskId: workspaceTask?.id,
    isTerminal: workspaceTask
      ? isTerminalTaskStatus(workspaceTask.status)
      : false,
    gatewayReady: gatewayUiStatus === "ready",
    onSendFailed: () => {
      toast({
        description: t("workspace.queueSendFailed"),
        variant: "destructive",
      });
    },
    onUndoAvailable: (removedId) => {
      const UNDO_MS = 8_000;
      toast({
        description: t("workspace.queueRemoved"),
        duration: UNDO_MS,
        action: {
          label: t("common.undo"),
          onClick: () => queueUndoRef.current(removedId),
        },
      });
      window.setTimeout(() => queuePurgeUndoRef.current(removedId), UNDO_MS);
    },
  });
  queueUndoRef.current = workspaceQueue.undoRemove;
  queuePurgeUndoRef.current = workspaceQueue.purgeUndo;

  /**
   * Every follow-up routes through outbox.enqueue (Task 16 useTaskSubmission).
   * Gateway drain is the only tasks.create acceptance path for follow-ups.
   */
  const { followUpTask: submitFollowUp } = useTaskSubmission({
    starting,
    setStarting,
    rpc: rpc as never,
    refreshOutbox: () => workspaceQueue.refresh(),
    onFollowUpAccepted: () => {
      withViewTransition(() => {
        setTaskSurface("workspace");
        setNav("tasks");
      });
    },
    onFollowUpRejected: (kind) => {
      toast({
        description:
          kind === "full"
            ? t("workspace.queueFull")
            : t("workspace.queueSendFailed"),
        variant: "destructive",
      });
    },
    onFollowUpError: (e) => {
      toast({ description: humanizeError(e, t), variant: "destructive" });
    },
  });

  async function followUpTask(
    goalText: string,
    attachments?: import("@grokdesk/shared").TaskAttachment[],
    clientMutationId?: string,
    revisionOfTaskId?: string,
  ): Promise<boolean> {
    return submitFollowUp({
      goalText,
      base: workspaceTask,
      conversationId: selectedChat?.id ?? workspaceTask?.id,
      attachments,
      clientMutationId,
      revisionOfTaskId,
      runSettings: {
        model,
        effort,
        approvalMode,
        planFirst,
        rolePack: rolePackId,
      },
    });
  }

  // Coalesced full resync on every transition into ready (do not wait for 30s poll).
  useAppSync({
    gatewayUiStatus,
    refreshTasks: () => refreshTasks().catch(() => {}),
    refreshOutbox: () => workspaceQueue.refresh(),
    refreshAuth: () => refreshAuth().catch(() => {}),
    refreshSideData: () => refreshSide().catch(() => {}),
    refreshEvents: () => {
      setEventsResyncKey((n) => n + 1);
      retryChatEvents();
    },
    rpc: rpc as never,
    onPendingRootAccepted: (task) => {
      setTasks((prev) => mergeCreatedTask(prev, task));
      setSelectedId(task.id);
      setTaskSurface("workspace");
      setNav("tasks");
    },
  });

  // Migrate localStorage queue → gateway outbox on first ready lifecycle.
  useEffect(() => {
    if (gatewayUiStatus !== "ready") return;
    let cancelled = false;
    void migrateLocalQueueToOutbox({
      rpc: (method, params) => rpc(method, params) as never,
      parentTaskIdForConversation: (cid) => {
        // Conversation roots are task ids for chat threads.
        const match = tasks.find(
          (t) => t.id === cid || t.parentTaskId === cid,
        );
        return match?.id ?? cid;
      },
    }).then((result) => {
      if (cancelled) return;
      if (result.status === "partial") {
        toast({
          description: t("workspace.queueMigrationPartial"),
          variant: "destructive",
        });
      }
      void workspaceQueue.refresh();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on ready edge
  }, [gatewayUiStatus]);

  const searchPlaceholder = topbarSearchPlaceholder(nav, {
    tasks: t("topbar.searchTasks"),
    artifacts: t("topbar.searchArtifacts"),
    memory: t("topbar.searchMemories"),
    scheduled: t("topbar.searchSchedules"),
    default: t("topbar.searchPlaceholder"),
  });

  const pickWorkspaceRoot = useCallback(() => {
    void pickDirectory().then((p) => {
      if (p) setWorkspaceRoot(p);
    });
  }, [setWorkspaceRoot]);

  const completeOnboarding = useCallback(
    async (opts: {
      enableRecommended: boolean;
      starterGoal: string;
      rolePackId: string | null;
      /** Explicit demo/limited path when user skipped SuperGrok. */
      demoMode?: boolean;
    }) => {
      try {
        await rpc("settings.set", onboardingSettingsPayload(approvalMode));
        if (opts.enableRecommended) {
          try {
            await rpc("connectors.enableRecommended", {});
          } catch {
            /* non-blocking: connectors are a nicety on first run */
          }
        }
        setRolePackId(opts.rolePackId);
        writeLastRolePackId(opts.rolePackId);
        // Seed first goal so activation is one Enter away (SOTA empty-state CTA)
        const seeded = seedStarterGoal(opts.starterGoal);
        if (seeded) setGoal(seeded);
        try {
          localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
        } catch {
          /* ignore */
        }
        const signedInNow = isAccountSignedIn({
          accountPhase: accountCtrlRef.current?.getSnapshot().phase,
          authSignedIn: auth?.signedIn,
        });
        updateActivation({
          accountResolved: true,
          demoMode: Boolean(opts.demoMode) || !signedInNow,
          projectFolderGranted: Boolean(root?.trim()),
        });
        // Handoff: leave full-window first launch → main shell
        withViewTransition(() => {
          setShowOnboarding(false);
          setNav("home");
        });
      } catch (e) {
        toast({ description: humanizeError(e, t), variant: "destructive" });
        throw e;
      }
    },
    [approvalMode, toast, t, auth?.signedIn, root, updateActivation],
  );

  // Wait for boot before the main shell (no product-license status gate).
  if (booting) {
    return (
      <div className="h-full w-full overflow-hidden text-base leading-normal">
        <BootScreen stage={bootStage} />
      </div>
    );
  }

  // Fresh open: full-window first launch only; never the main shell/chat.
  if (showOnboarding) {
    return (
      <div className="h-full w-full overflow-hidden text-base leading-normal">
        <Suspense fallback={<ViewFallback />}>
          <OnboardingWizard
            auth={auth}
            root={root}
            onPickRoot={pickWorkspaceRoot}
            approvalMode={approvalMode}
            onApprovalMode={setApprovalMode}
            rolePackId={rolePackId}
            onRolePack={setRolePackId}
            onSignIn={() => void signIn()}
            onComplete={completeOnboarding}
            starting={starting}
            runtimeInstallStatus={updateStatus.status}
            runtimeInstallPending={updateStatus.pending}
            onRuntimeInstallCheck={() => {
              void updateStatus.check();
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden text-base leading-normal animate-fade-in">
      <AppSidebar
        nav={nav}
        onNav={(id) =>
          withViewTransition(() => {
            const effects = navChangeSideEffects(id);
            setNav(id);
            if (effects.clearSearch) setSearch("");
            if (effects.clearTaskSearch) setTaskSearch("");
            if (effects.forceListSurface) setTaskSurface("list");
          })
        }
        chats={chats}
        selectedChatId={selectedChat?.id ?? null}
        onOpenChat={(latestId) => openTaskWorkspace(latestId)}
        onRenameChat={(rootId, title) => void renameChat(rootId, title)}
        onResetChatTitle={(rootId) => void resetChatTitle(rootId)}
        onDeleteChat={(rootId) => void removeChat(rootId)}
        onTogglePinChat={(rootId) => togglePinChat(rootId)}
        pinnedChatIds={pinStore.ids}
        onNewTask={() =>
          withViewTransition(() => {
            const next = newChatNavState();
            setNav(next.nav);
            setSelectedId(next.selectedId);
            setTaskSurface(next.taskSurface);
            setGoal(next.goal);
          })
        }
        auth={effectiveAuth}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
        onRefreshAuth={() => void refreshAuth()}
        onCancelTask={(id) => void cancelTask(id)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() =>
          withViewTransition(() => setSidebarCollapsed((v) => !v))
        }
        inboxUnread={waitingOnYou.inboxBadge}
        needsInputTaskIds={waitingOnYouTaskIdList}
        onOpenInbox={() => setInboxOpen(true)}
        usage={usageSnap}
        showSignInInvite={
          !signedIn &&
          (shouldShowSignInInvite(accountSnap?.phase ?? "checking") ||
            accountSnap?.phase === "reauth_required" ||
            accountSnap?.phase === "error")
        }
        accountAttention={
          shouldShowReauthBanner(accountSnap?.phase ?? "signed_out") ||
          Boolean(effectiveAuth?.needsReauth)
        }
        onOpenAccount={() => {
          withViewTransition(() => {
            const next = openAccountSettingsNavState();
            setNav(next.nav);
            setSettingsTab(next.settingsTab);
          });
        }}
      />

      <div
        className={`${MOTION_SURFACE_CLASSES.navigation /* includes vt-content */} flex min-w-0 flex-1 flex-col overflow-hidden bg-background`}
      >
        <NoticeSlot
          notices={buildShellNotices({
            gatewayUiStatus,
            // I11/I2: when Home owns the readiness checklist, suppress
            // stacked runtime/reauth banners.
            readinessBlocked: projectDesktopReadiness(shellReadinessInput)
              .blocked,
            runtimeBlocked: auth?.engineStatus === "missing",
            // Never show reauth to never-signed-in users (account phase).
            needsReauth:
              shouldShowReauthBanner(accountSnap?.phase ?? "signed_out") ||
              Boolean(auth?.needsReauth),
            signingIn: accountSnap?.phase === "signing_in",
          })}
          maxVisible={3}
          render={(n) => {
            if (n.kind === "gateway_dead") {
              return (
                <div
                  role="status"
                  className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-destructive/40 bg-destructive/15 px-4 py-2 text-center text-xs text-destructive-text"
                >
                  <span>{t("status.gatewayDead")}</span>
                  <button
                    type="button"
                    className="rounded-md border border-destructive/40 px-2 py-0.5 font-medium hover:bg-destructive/20"
                    onClick={() => {
                      void restartGateway().then((r) => {
                        if (!r.ok) {
                          toast({
                            description: t("status.gatewayRetryFailed"),
                            variant: "destructive",
                          });
                        }
                      });
                    }}
                  >
                    {t("status.retryEngine")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-destructive/40 px-2 py-0.5 font-medium hover:bg-destructive/20"
                    onClick={() => {
                      void openLogsFolder();
                    }}
                  >
                    {t("status.openLogs")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-destructive/40 px-2 py-0.5 font-medium hover:bg-destructive/20"
                    onClick={() => {
                      void copyDiagnostics().then((ok) => {
                        toast({
                          description: ok
                            ? t("status.diagnosticsCopied")
                            : t("status.diagnosticsCopyFailed"),
                        });
                      });
                    }}
                  >
                    {t("status.copyDiagnostics")}
                  </button>
                </div>
              );
            }
            if (n.kind === "gateway_reconnecting") {
              return (
                <div
                  role="status"
                  className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-xs text-warning"
                >
                  <span>{t("status.gatewayReconnecting")}</span>
                  <button
                    type="button"
                    className="rounded-md border border-warning/40 px-2 py-0.5 font-medium hover:bg-warning/15"
                    onClick={() => {
                      void restartGateway();
                    }}
                  >
                    {t("status.retryEngine")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-warning/40 px-2 py-0.5 font-medium hover:bg-warning/15"
                    onClick={() => {
                      void openLogsFolder();
                    }}
                  >
                    {t("status.openLogs")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-warning/40 px-2 py-0.5 font-medium hover:bg-warning/15"
                    onClick={() => {
                      void copyDiagnostics();
                    }}
                  >
                    {t("status.copyDiagnostics")}
                  </button>
                </div>
              );
            }
            if (n.kind === "reauth") {
              return (
                <div
                  role="status"
                  className="flex shrink-0 items-center justify-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning"
                >
                  <span>{t("settings.reauthBanner")}</span>
                  <button
                    type="button"
                    className="rounded-md border border-warning/40 px-2 py-0.5 font-medium hover:bg-warning/15"
                    onClick={() => void signIn()}
                  >
                    {t("settings.reauthSignIn")}
                  </button>
                </div>
              );
            }
            if (n.kind === "signing_in") {
              return (
                <div
                  role="status"
                  className="flex shrink-0 items-center justify-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs text-foreground"
                  data-account-phase="signing_in"
                >
                  <span>
                    {accountSnap?.signInStep === "verifying"
                      ? t("account.signInVerifying")
                      : t("toast.completeLogin")}
                  </span>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-0.5 font-medium hover:bg-muted"
                    onClick={() => cancelSignIn()}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              );
            }
            return null;
          }}
        />
        {GROKDESK_REMOTE_UI_ENABLED ? (
          <Suspense fallback={null}>
            <RemoteControlBanner />
          </Suspense>
        ) : null}
        {shouldShowSecurityUpdateBanner(updateStatus.status) ? (
          <SecurityUpdateBanner
            status={updateStatus.status}
            updating={updateStatus.pending}
            onUpdate={() => {
              void updateStatus.updateNow();
            }}
            onOpenSettings={() => {
              withViewTransition(() => {
                const next = openSettingsNavState("advanced");
                setNav(next.nav);
                setSettingsTab(next.settingsTab);
              });
            }}
          />
        ) : null}

        {activation.demoMode &&
          !signedIn &&
          accountSnap?.phase !== "signing_in" && (
            <div
              role="status"
              data-demo-mode="true"
              className="flex shrink-0 items-center justify-center gap-3 border-b border-muted-foreground/20 bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
            >
              <span>{t("account.demoModeBanner")}</span>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-0.5 font-medium text-foreground hover:bg-muted"
                onClick={() => void signIn()}
              >
                {t("nav.signIn")}
              </button>
            </div>
          )}
        {nav === "home" && <div className="titlebar-drag h-9 shrink-0" />}
        {nav !== "home" && (
          <AppTopbar
            searchPlaceholder={searchPlaceholder}
            search={topbarSearchValue({ nav, search, taskSearch })}
            showSearch={shouldShowTopbarSearch(nav)}
            onSearch={(v) => {
              if (nav === "tasks") {
                const dual = dualSearchValue(v);
                setSearch(dual.search);
                setTaskSearch(dual.taskSearch);
              } else {
                setSearch(v);
              }
            }}
            signedIn={signedIn}
            engineStatus={effectiveAuth?.engineStatus}
            accountLabel={effectiveAuth?.accountLabel}
            accountName={effectiveAuth?.accountName}
            onNewTask={() =>
              withViewTransition(() => {
                setNav("home");
                setGoal("");
              })
            }
            onOpenSettings={() =>
              withViewTransition(() => {
                const next = openSettingsNavState();
                setNav(next.nav);
                setSettingsTab(next.settingsTab);
              })
            }
            onOpenPalette={() => setPaletteOpen(true)}
            onSignIn={() => void signIn()}
          />
        )}

        {booting && (
          <div className="flex flex-1 justify-center overflow-hidden">
            <div className="w-full max-w-3xl animate-fade-in px-8 pt-16">
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-4 w-80" />
              </div>
              <Skeleton className="mt-9 h-[168px] w-full rounded-2xl" />
              <div className="mt-11 grid gap-3 sm:grid-cols-3">
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
              </div>
            </div>
          </div>
        )}

        {!booting && nav === "home" && (
          <HomeView
            greeting={greeting}
            goal={goal}
            onGoal={setGoal}
            composerIntentId={composerIntentId}
            onComposerIntent={setComposerIntentId}
            root={root}
            onPickRoot={pickWorkspaceRoot}
            onClearRoot={() => setWorkspaceRoot("")}
            model={model}
            models={models}
            onModel={setModel}
            effort={effort}
            onEffort={setEffort}
            planFirst={planFirst}
            onPlanFirst={setPlanFirst}
            rolePacks={rolePacks}
            rolePackId={rolePackId}
            onRolePack={setRolePackId}
            approvalMode={approvalMode}
            onApprovalMode={setApprovalMode}
            starting={starting}
            attachments={homeAttachments}
            onAttachments={setHomeAttachments}
            draftRestoredNotice={draftRestoredNotice}
            onDismissDraftRestored={() => setDraftRestoredNotice(false)}
            onRun={(g, atts, media) => void createTask(g, atts, media)}
            tasks={tasks}
            memories={memories}
            schedules={schedules}
            inbox={inbox.items}
            artifacts={artifacts}
            auth={effectiveAuth}
            onOpenTask={openTaskWorkspace}
            onOpenTasks={() => openTaskList()}
            onOpenScheduled={() =>
              withViewTransition(() => setNav("scheduled"))
            }
            onOpenArtifacts={() => setNav("artifacts")}
            onOpenMemory={() => setNav("memory")}
            onAddMemory={() => setNav("memory")}
            onRevealWorkspace={(p) => void revealPath(p)}
            onCancelTask={(id) => void cancelTask(id)}
            onOpenSettings={() =>
              withViewTransition(() => {
                const next = openAccountSettingsNavState();
                setSettingsTab(next.settingsTab);
                setNav(next.nav);
              })
            }
            onOpenTools={() =>
              withViewTransition(() => {
                const next = openToolsNavState();
                setSettingsTab(next.settingsTab);
                setNav(next.nav);
              })
            }
            onSignIn={() => void signIn()}
            usageWarn={usageChipFromSnapshot(usageSnap)}
            onOpenUsage={() =>
              withViewTransition(() => {
                const next = openAccountSettingsNavState();
                setSettingsTab(next.settingsTab);
                setNav(next.nav);
              })
            }
            needsYouItems={needsYouItems}
            onOpenInbox={() => setInboxOpen(true)}
            focusComposerToken={focusComposerToken}
            readinessItems={projectDesktopReadiness(shellReadinessInput).items}
            runtimeInstallStatus={updateStatus.status}
            runtimeInstallPending={updateStatus.pending}
            onRuntimeInstallCheck={() => {
              void updateStatus.check();
            }}
            onReadinessAction={(action) => {
              if (action === "sign-in") {
                withViewTransition(() => {
                  const next = openAccountSettingsNavState();
                  setSettingsTab(next.settingsTab);
                  setNav(next.nav);
                });
                void signIn();
              } else if (action === "choose-workspace") {
                void pickWorkspaceRoot();
              } else if (action === "install-runtime") {
                // Primary CTA: start managed runtime check/install, then
                // open Settings → Advanced for full Runtime & updates UI.
                void updateStatus.check();
                withViewTransition(() => {
                  setSettingsTab("advanced");
                  setNav("settings");
                });
              }
            }}
          />
        )}

        {!booting &&
          nav === "home" &&
          root.trim() &&
          // folderTrustUiTick forces re-eval after session dismiss.
          folderTrustUiTick >= 0 &&
          shouldShowFolderTrustPrompt({
            workspacePath: root,
            trustedFolders: appSettings.trustedFolders,
          }) && (
            <div className="px-4 pb-2 sm:px-6">
              <FolderTrustPrompt
                folderPath={root}
                onTrust={() => {
                  const next = trustFolder(appSettings.trustedFolders, root);
                  void rpc("settings.set", { trustedFolders: next })
                    .then(() => {
                      setAppSettings((s) => ({
                        ...s,
                        trustedFolders: next,
                      }));
                    })
                    .catch((e: unknown) => {
                      toast({
                        description: humanizeError(e, t),
                        variant: "destructive",
                      });
                    });
                }}
                onNotNow={() => {
                  dismissFolderTrustPrompt(root);
                  setFolderTrustUiTick((n) => n + 1);
                }}
              />
            </div>
          )}

        {!booting && nav === "tasks" && taskSurface === "list" && (
          <TasksView
            tasks={tasks}
            artifacts={artifacts}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onOpenWorkspace={openTaskWorkspace}
            filter={taskFilter}
            onFilter={setTaskFilter}
            search={taskSearch || search}
            onCancel={(id) => void cancelTask(id)}
            onNewTask={() =>
              withViewTransition(() => {
                setNav("home");
                setGoal("");
                setHomeAttachments([]);
                setFocusComposerToken((n) => n + 1);
              })
            }
          />
        )}

        {!booting &&
          nav === "tasks" &&
          taskSurface === "workspace" &&
          workspaceTask && (
            <TaskWorkspaceView
              key={selectedChat?.id ?? workspaceTask.id}
              task={workspaceTask}
              chatTitle={selectedChat?.title ?? chatTitle(workspaceTask)}
              events={events}
              eventsByTask={eventsByTask}
              eventsLoading={eventsLoading}
              eventsError={eventsError}
              eventsStaleSince={eventsStaleSince}
              eventsTruncated={eventsTruncated}
              onRetryEvents={retryChatEvents}
              artifacts={artifacts}
              pendingApproval={pendingApproval}
              focusApprovalId={focusApprovalId}
              onFocusApprovalConsumed={() => setFocusApprovalId(null)}
              threadTasks={workspaceThreadTasks}
              onFocusTask={(id) => {
                setSelectedId(id);
              }}
              onBackToList={() => openTaskList(workspaceTask.id)}
              onHome={() => withViewTransition(() => setNav("home"))}
              onPauseAll={() => void rpc("tasks.pauseAll", {})}
              onResumeAll={() => void rpc("tasks.resumeAll", {})}
              onCancel={() => void cancelTask(workspaceTask.id)}
              onApprove={async ({ taskId, approvalId }) => {
                await rpc("tasks.approve", {
                  taskId,
                  approvalId,
                  decision: "approve",
                });
              }}
              onReject={async ({ taskId, approvalId }) => {
                await rpc("tasks.approve", {
                  taskId,
                  approvalId,
                  decision: "reject",
                });
              }}
              onFollowUp={(g, atts, clientMutationId, revisionOfTaskId) =>
                followUpTask(g, atts, clientMutationId, revisionOfTaskId)
              }
              queueController={workspaceQueue}
              followUpBusy={starting}
              engineReady={gatewayUiStatus === "ready"}
              signedIn={signedIn}
              onSignIn={() => void signIn()}
              onOpenSettings={() => {
                const next = openAccountSettingsNavState();
                setSettingsTab(next.settingsTab);
                setNav(next.nav);
              }}
              root={root}
              onPickRoot={pickWorkspaceRoot}
              onOpenScheduled={() =>
                withViewTransition(() => setNav("scheduled"))
              }
              onOpenTools={() =>
                withViewTransition(() => {
                  const next = openToolsNavState();
                  setSettingsTab(next.settingsTab);
                  setNav(next.nav);
                })
              }
              onOpenMemory={() => setNav("memory")}
              effort={effort}
              onEffort={setEffort}
              model={model}
              models={models}
              onModel={setModel}
              approvalMode={approvalMode}
              onApprovalMode={setApprovalMode}
              planFirst={planFirst}
              onPlanFirst={setPlanFirst}
              rolePacks={rolePacks}
              rolePackId={rolePackId}
              onRolePack={setRolePackId}
              onRememberTakeaways={(taskId) => {
                const tsk = tasks.find((x) => x.id === taskId);
                if (!tsk) return;
                void (async () => {
                  let evs = events;
                  if (
                    !shouldReuseLocalEventsForTakeaways({
                      selectedId,
                      workspaceTaskId: workspaceTask?.id,
                      targetTaskId: taskId,
                    })
                  ) {
                    try {
                      const pages: TaskEvent[] = [];
                      let after = 0;
                      for (let page = 0; page < 20; page++) {
                        const batch = await rpc<TaskEvent[]>("events.list", {
                          taskId,
                          afterSeq: after,
                        });
                        if (!Array.isArray(batch) || batch.length === 0) break;
                        pages.push(...batch);
                        after = batch.reduce(
                          (m, e) =>
                            Math.max(m, typeof e.seq === "number" ? e.seq : m),
                          after,
                        );
                        if (batch.length < 500) break;
                      }
                      evs = pages;
                    } catch {
                      evs = [];
                    }
                  }
                  const upsert = takeawaysMemoryUpsert({
                    task: tsk,
                    events: evs.map((e) => ({
                      kind: e.kind,
                      payload: e.payload,
                    })),
                    buildContent: buildTakeawaysContent,
                  });
                  try {
                    await rpc("memory.upsert", upsert);
                    toast({ description: t("memory.saved") });
                  } catch {
                    toast({
                      description: t("memory.saveFailed"),
                      variant: "destructive",
                    });
                  }
                  void refreshSide();
                })();
              }}
              onRememberText={async ({ taskId, text, goal }) => {
                const titleGoal = (goal || "").replace(/\s+/g, " ").trim().slice(0, 80);
                try {
                  await rpc("memory.upsert", {
                    kind: "episodic",
                    title: titleGoal ? `Takeaway: ${titleGoal}` : "Takeaway",
                    content: text.slice(0, 8000),
                    provenance: `task:${taskId}`,
                  });
                  toast({ description: t("memory.saved") });
                  void refreshSide();
                } catch {
                  toast({
                    description: t("memory.saveFailed"),
                    variant: "destructive",
                  });
                }
              }}
              onImagineFromTask={(_taskId, goal) => {
                const next = imagineFromTaskNavState(goal);
                setGoal(next.goal);
                withViewTransition(() => {
                  setNav(next.nav);
                  setFocusComposerToken((n) => n + 1);
                });
                toast({
                  description: t("toast.imagineReview"),
                  variant: "success",
                });
              }}
              onScheduleFromTask={(goalTemplate) => {
                const next = scheduleFromTaskNavState(goalTemplate);
                setScheduleDraftGoal(next.goal);
                withViewTransition(() => setNav(next.nav));
                toast({
                  description: t("workspace.nextSchedule"),
                });
              }}
            />
          )}

        {!booting && nav === "scheduled" && (
          <Suspense fallback={<ViewFallback />}>
            <ScheduledView
              schedules={filterSchedulesBySearch(schedules, search)}
              root={root}
              models={models}
              initialGoal={scheduleDraftGoal}
              onInitialGoalConsumed={() => setScheduleDraftGoal(null)}
              onPickRoot={() =>
                void pickDirectory().then((p) => {
                  if (p) setWorkspaceRoot(p);
                })
              }
              onCreate={(input) => {
                void rpc(
                  "schedule.create",
                  scheduleCreateParams({
                    form: input,
                    root,
                    timezone:
                      Intl.DateTimeFormat().resolvedOptions().timeZone ||
                      "UTC",
                  }),
                ).then(refreshSide);
              }}
              onToggle={(id, enabled) =>
                void rpc("schedule.setEnabled", { id, enabled }).then(
                  refreshSide,
                )
              }
              onDelete={(id) =>
                void rpc("schedule.delete", { id }).then(refreshSide)
              }
              onError={(msg) =>
                toast({ description: msg, variant: "destructive" })
              }
            />
          </Suspense>
        )}

        {!booting && nav === "artifacts" && (
          <Suspense fallback={<ViewFallback />}>
            <ArtifactsView
              artifacts={artifacts}
              tasks={tasks}
              initialSearch={search}
              hideLocalSearch={!shouldShowViewLocalSearch("artifacts")}
              onOpenTask={(taskId) => openTaskWorkspace(taskId)}
            />
          </Suspense>
        )}

        {!booting && nav === "memory" && (
          <Suspense fallback={<ViewFallback />}>
            <MemoryView
              memories={filterMemoriesBySearch(memories, search)}
              suggestions={pendingMemorySuggestions(memorySuggestionStore)}
              weeklyRecap={weeklyRecap}
              onRememberRecapLine={async (line) => {
                try {
                  await rpc("memory.upsert", {
                    kind: "episodic",
                    title: line.slice(0, 80),
                    content: line,
                    provenance: "recap",
                  });
                  toast({ description: t("memory.saved") });
                  await refreshSide();
                } catch {
                  toast({
                    description: t("memory.saveFailed"),
                    variant: "destructive",
                  });
                }
              }}
              onSave={async (input) => {
                await rpc("memory.upsert", input);
                await refreshSide();
              }}
              onDelete={(id) =>
                void rpc("memory.delete", { id }).then(refreshSide)
              }
              onApproveSuggestion={async (id, patch) => {
                const next = approveMemorySuggestion(
                  memorySuggestionStore,
                  id,
                  patch,
                );
                if (!next.approved) return;
                await rpc(
                  "memory.upsert",
                  suggestionToMemoryUpsert(next.approved),
                );
                setMemorySuggestionStore(next.store);
                saveMemorySuggestionStore(next.store);
                toast({ description: t("memory.suggestionApproved") });
                await refreshSide();
              }}
              onEditSuggestion={(id, patch) => {
                const store = editMemorySuggestion(
                  memorySuggestionStore,
                  id,
                  patch,
                );
                setMemorySuggestionStore(store);
                saveMemorySuggestionStore(store);
              }}
              onDismissSuggestion={(id) => {
                const store = dismissMemorySuggestion(
                  memorySuggestionStore,
                  id,
                );
                setMemorySuggestionStore(store);
                saveMemorySuggestionStore(store);
                toast({ description: t("memory.suggestionDismissed") });
              }}
            />
          </Suspense>
        )}

        {!booting && nav === "settings" && (
          <Suspense fallback={<ViewFallback />}>
            <SettingsView
              auth={effectiveAuth}
              models={models}
              defaultModel={model}
              onDefaultModel={setModel}
              approvalMode={approvalMode}
              onApprovalMode={(mode) => {
                void (async () => {
                  if (mode === "autopilot" && approvalMode !== "autopilot") {
                    const ok = await ownedConfirm.ask({
                      title: t("onboarding.policyAutopilot"),
                      description: t("onboarding.policyAutopilotDesc"),
                    });
                    if (!ok) return;
                  }
                  setApprovalMode(mode);
                  void rpc("settings.set", { defaultApprovalMode: mode }).catch(
                    () => {
                      /* non-blocking: local state still updates for this session */
                    },
                  );
                })();
              }}
              mcpServers={appSettings.mcpServers}
              skillsPaths={appSettings.skillsPaths}
              effectiveSkillsPaths={appSettings.effectiveSkillsPaths}
              preferProviderEngine={appSettings.preferProviderEngine}
              inheritUserGrok={appSettings.inheritUserGrok}
              trustedFolders={appSettings.trustedFolders}
              onUntrustFolder={(folderPath) => {
                const next = untrustFolder(
                  appSettings.trustedFolders,
                  folderPath,
                );
                void rpc("settings.set", { trustedFolders: next })
                  .then(() => {
                    setAppSettings((s) => ({ ...s, trustedFolders: next }));
                  })
                  .catch((e: unknown) => {
                    toast({
                      description: humanizeError(e, t),
                      variant: "destructive",
                    });
                  });
              }}
              initialTab={settingsTab}
              onRunSetupAgain={() => {
                // Re-enter setup with current values; never silently reset approval.
                setShowOnboarding(true);
              }}
              onSignIn={() => void signIn()}
              onSignOut={() => void signOut()}
              onRefreshAuth={() => void refreshAuth()}
              usageSnapshot={usageSnap}
              onUsageChange={(snap) => setUsageSnap(snap)}
              onMcpServersChange={(mcpServers) =>
                setAppSettings((s) => ({ ...s, mcpServers }))
              }
              onSettingsChange={async (next) => {
                const saved = await rpc<{
                  mcpServers: typeof appSettings.mcpServers;
                  skillsPaths: string[];
                  effectiveSkillsPaths?: string[];
                  preferProviderEngine?: boolean;
                  inheritUserGrok?: boolean;
                  trustedFolders?: string[];
                  engineReloaded?: boolean;
                }>("settings.set", next);
                const merged = appSettingsAfterSave({
                  prior: appSettings,
                  next,
                  saved,
                });
                setAppSettings(merged.slice as typeof appSettings);
                toast({
                  description: t(merged.toastKey),
                  variant: "success",
                });
              }}
            />
          </Suspense>
        )}
      </div>

      <Suspense fallback={null}>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          tasks={tasks}
          searchConversations={(query) =>
            rpc<SessionSearchView>("sessions.search", { query })
          }
          signedIn={signedIn}
          readinessBlocked={
            projectDesktopReadiness(shellReadinessInput).blocked
          }
          onNewTask={() =>
            withViewTransition(() => {
              const next = newChatNavState();
              setNav(next.nav);
              setSelectedId(next.selectedId);
              setTaskSurface(next.taskSurface);
              setGoal(next.goal);
            })
          }
          onNavigate={(id) =>
            withViewTransition(() => {
              const effects = navChangeSideEffects(id);
              setNav(id);
              if (effects.forceListSurface) setTaskSurface("list");
            })
          }
          onOpenTask={openTaskWorkspace}
          chatCommands={[
            {
              id: "compact",
              label: t("slash.compact"),
              keywords: ["summarize", "compact", "tidy"],
              onSelect: () => {
                if (!selectedId) {
                  toast({ description: t("slash.needOpenChat") });
                  return;
                }
                void taskCompact(selectedId).then((r) => {
                  if (!r.ok) {
                    toast({
                      description: t("workspace.summarizeUnavailable"),
                      variant: "destructive",
                    });
                  }
                });
              },
            },
            {
              id: "remember",
              label: t("slash.remember"),
              keywords: ["memory", "remember", "takeaways"],
              onSelect: () => {
                if (selectedId) {
                  const tsk = tasks.find((x) => x.id === selectedId);
                  if (tsk) {
                    void rpc("memory.upsert", {
                      kind: "episodic",
                      title: `Takeaway: ${(tsk.title || tsk.goal).slice(0, 80)}`,
                      content: tsk.goal,
                      provenance: `task:${tsk.id}`,
                    }).then(
                      () => toast({ description: t("memory.saved") }),
                      () =>
                        toast({
                          description: t("memory.saveFailed"),
                          variant: "destructive",
                        }),
                    );
                    return;
                  }
                }
                withViewTransition(() => setNav("memory"));
              },
            },
            {
              id: "deep-research",
              label: t("slash.deepResearch"),
              keywords: ["research", "workflow", "deep"],
              onSelect: () => {
                withViewTransition(() => {
                  const next = newChatNavState();
                  setNav(next.nav);
                  setSelectedId(next.selectedId);
                  setTaskSurface(next.taskSurface);
                  setGoal("/deep-research ");
                  setFocusComposerToken((n) => n + 1);
                });
              },
            },
            {
              id: "monitor",
              label: t("slash.monitor"),
              keywords: ["watch", "monitor", "until"],
              onSelect: () => {
                withViewTransition(() => {
                  const next = newChatNavState();
                  setNav(next.nav);
                  setSelectedId(next.selectedId);
                  setTaskSurface(next.taskSurface);
                  setGoal("/watch ");
                  setFocusComposerToken((n) => n + 1);
                });
              },
            },
          ]}
          onStopTask={(id) => void cancelTask(id)}
          onSignIn={() => void signIn()}
          onRunSetupAgain={() => {
            setPaletteOpen(false);
            setShowOnboarding(true);
          }}
          onOpenUsage={() => {
            const next = openAccountSettingsNavState();
            setSettingsTab(next.settingsTab);
            setNav(next.nav);
          }}
          onOpenBilling={() => void openBilling()}
          onOpenDocs={() => openDocsWindow()}
          onOpenInbox={() => setInboxOpen(true)}
          onShowShortcuts={() => {
            setPaletteOpen(false);
            setShortcutsOpen(true);
          }}
          inboxUnread={waitingOnYou.inboxBadge}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </Suspense>

      <Suspense fallback={null}>
      <InboxPanel
        open={inboxOpen}
        onOpenChange={setInboxOpen}
        items={inbox.items}
        workspaceRoots={inboxWorkspaceRoots(root)}
        model={model}
        effort={effort}
        approvalMode={approvalMode}
        onDismiss={(id) => inbox.dismiss(id)}
        onMarkRead={(id) => inbox.markRead(id)}
        onOpenTask={openTaskWorkspace}
        onOpenSettings={() =>
          withViewTransition(() => {
            const next = openAccountSettingsNavState();
            setSettingsTab(next.settingsTab);
            setNav(next.nav);
            setInboxOpen(false);
          })
        }
        onScheduleCreated={() => {
          setNav("scheduled");
          setInboxOpen(false);
        }}
        onRefreshSide={() => void refreshSide()}
        onRememberRecapLine={async (line) => {
          try {
            await rpc("memory.upsert", {
              kind: "episodic",
              title: line.slice(0, 80),
              content: line,
              provenance: "recap",
            });
            toast({ description: t("memory.saved") });
            void refreshSide();
          } catch {
            toast({
              description: t("memory.saveFailed"),
              variant: "destructive",
            });
          }
        }}
      />
      </Suspense>

      {ownedConfirm.dialog}
      <UpdateRestartDialog
        open={shouldShowUpdateRestartDialog(updateStatus.status)}
        status={updateStatus.status}
        busy={updateStatus.pending}
        onInstallRestart={() => {
          void updateStatus.installRestart();
        }}
        onWaitForIdle={() => {
          // Same main path: approve restart and wait for idle work.
          void updateStatus.installRestart();
        }}
        onCancel={() => {
          void updateStatus.cancel();
        }}
      />
    </div>
  );
}
