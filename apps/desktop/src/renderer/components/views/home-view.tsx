import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  FileText,
  FolderOpen,
  FolderKanban,
  ImageIcon,
  Loader2,
  Paperclip,
  PenLine,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { HomeRailCard } from "./home-rail-card";
import {
  pathsFromDropFiles,
  projectMentionCandidatesFromList,
  resolveHomeActiveRoot,
} from "@/lib/home-composer-helpers";
import { isManagedWorkspacePath } from "@/lib/managed-workspace";
import { DictationButton } from "@/components/dictation-button";
import { useDictation } from "@/hooks/use-dictation";
import { useElapsedSeconds } from "@/hooks/use-elapsed";
import { getActiveLocale } from "@/i18n/active";
import { formatElapsed, taskElapsedStartIso } from "@/lib/elapsed";
import {
  ArmedCommandChip,
  stripArmedSlashPrefix,
} from "@/components/armed-command-chip";
import { ComposerAttachments } from "@/components/composer-attachments";
import { FileMentionMenu } from "@/components/file-mention-menu";
import { SlashCommandMenu } from "@/components/slash-command-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AnimatedNumber } from "@/components/ui/animated-number";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { relativeTime, shortPath } from "@/lib/format";
import { taskStatusLabel } from "@/lib/labels";
import { statusDotClass } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { LinkAction, SectionHeading } from "@/components/section-heading";
import {
  addPathsToAttachments,
  blobToBase64,
  imageExtFromMime,
  removeAttachment,
  toTaskAttachments,
  type ClientAttachment,
} from "@/lib/attachments";
import {
  extractMentionQuery,
  filterMentionCandidates,
  insertMentionToken,
  type MentionCandidate,
} from "@/lib/mention-files";
import {
  applySlashCommand,
  armedEffortTransition,
  armedSlashCommand,
  composerKeyAction,
  extractSlashQuery,
  filterSlashCommands,
  isSlashMenuVisible,
  slashDismissKey,
  type ArmedEffortState,
  type SlashCommand,
} from "@/lib/composer-input";
import {
  clearComposerIntent,
  emptyComposerModeState,
  findComposerIntent,
  pickComposerIntents,
  selectComposerIntent,
  type ComposerIntentId,
  type ComposerModeState,
} from "@/lib/composer-intents";
import { buildCoworkerHomeModel } from "@/lib/coworker-home";
import {
  loadRecipeStore,
  markRecipeUsed,
  recipeGoalForComposer,
  saveRecipeStore,
} from "@/lib/task-recipes";
import { dismissDiscovery } from "@/lib/capability-discovery";
import {
  loadWorkSession,
  saveWorkSession,
  touchWorkSession,
} from "@/lib/work-session";
import { polishGoal, shouldOfferGoalPolish } from "@/lib/goal-polish";
import { detectStaleWork } from "@/lib/stale-work";
import { rankRecentDeliverables } from "@/lib/recent-deliverables";
import { planHomeLanding } from "@/lib/home-landing-policy";
import { recentTasksForHomeDesk } from "@/lib/home-recent-tasks";
import {
  disambiguateScanTitles,
  preferredChatScanTitle,
} from "@/lib/chat-title";
import { intentChipMotionClass } from "@/lib/motion-system";
import { pickFiles, rpc, writeTempAttachment } from "@/lib/api";
import {
  isActiveTaskStatus,
  type Artifact,
  type AuthState,
  type EffortLevel,
  type InboxItem,
  type MemoryItem,
  type RolePack,
  type ScheduleRule,
  type Task,
  type TaskAttachment,
} from "@grokdesk/shared";
import { useT } from "@/i18n";
import { effortLabel } from "@/lib/labels";
import { useToast } from "@/components/ui/toast";
import { RolePackPicker } from "@/components/role-pack-picker";
import { NoticeSlot } from "@/components/notice-slot";
import { ReadinessChecklist } from "@/components/readiness-checklist";
import { RuntimeInstallStep } from "@/components/runtime-install-step";
import {
  noticePriority,
  type NoticeItem,
} from "@/lib/notice-priority";
import { isReadinessBlocked } from "@grokdesk/shared";
import { needsYouOpenTarget } from "@/lib/needs-you-open";

export function HomeView(props: {
  greeting: { title: string; subtitle: string };
  goal: string;
  onGoal: (v: string) => void;
  /**
   * Phase 3 structured intent mode (chip). Expanded at send — not dumped
   * into the textarea. Null clears mode.
   */
  composerIntentId?: ComposerIntentId | null;
  onComposerIntent?: (id: ComposerIntentId | null) => void;
  root: string;
  onPickRoot: () => void;
  onClearRoot: () => void;
  model: string;
  models: string[];
  onModel: (v: string) => void;
  effort: EffortLevel;
  onEffort: (v: EffortLevel) => void;
  planFirst?: boolean;
  onPlanFirst?: (v: boolean) => void;
  rolePacks: RolePack[];
  rolePackId: string | null;
  onRolePack: (id: string | null) => void;
  approvalMode: "strict" | "balanced" | "autopilot";
  onApprovalMode: (v: "strict" | "balanced" | "autopilot") => void;
  starting: boolean;
  attachments: TaskAttachment[];
  onAttachments: (
    a: TaskAttachment[] | ((prev: TaskAttachment[]) => TaskAttachment[]),
  ) => void;
  /**
   * One-shot "Draft restored" after boot hydrate (Task 12).
   * Parent owns state; dismiss clears so it never re-toasts on rerender.
   */
  draftRestoredNotice?: boolean;
  onDismissDraftRestored?: () => void;
  onRun: (goal?: string, attachments?: TaskAttachment[]) => void;
  tasks: Task[];
  memories: MemoryItem[];
  schedules: ScheduleRule[];
  artifacts: Artifact[];
  auth: (AuthState & { models?: string[] }) | null;
  /**
   * Open a conversation; optional approvalId focuses the parked approval (I10).
   */
  onOpenTask: (id: string, opts?: { approvalId?: string | null }) => void;
  onOpenTasks: () => void;
  onOpenScheduled: () => void;
  onOpenArtifacts: () => void;
  onOpenMemory: () => void;
  onAddMemory: () => void;
  onRevealWorkspace?: (path: string) => void;
  onCancelTask?: (id: string) => void;
  onOpenSettings?: () => void;
  onOpenTools?: () => void;
  onSignIn?: () => void;
  usageWarn?: { pct: number; level: "soft" | "hard" } | null;
  onOpenUsage?: () => void;
  /**
   * Unread needs-you items (I10: may include deepLink from needsYouInboxItems).
   */
  needsYouItems?: Array<
    InboxItem & {
      deepLink?: { taskId: string | null; approvalId: string | null };
      approvalId?: string | null;
    }
  >;
  onOpenInbox?: () => void;
  /** Focus the compose box when this counter ticks (from global shortcuts). */
  focusComposerToken?: number;
  /**
   * I11: when create/run is blocked, single checklist (License · Runtime ·
   * Sign-in · Workspace) instead of stacked banners.
   */
  readinessItems?: import("@grokdesk/shared").ReadinessChecklistItem[];
  onReadinessAction?: (action: string) => void;
  /** When engine is missing, show RuntimeInstallStep above the checklist. */
  runtimeInstallStatus?: import("@grokdesk/shared").UpdateStatus | null;
  onRuntimeInstallCheck?: () => void;
  runtimeInstallPending?: boolean;
}) {
  const t = useT();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [mentionActive, setMentionActive] = useState(0);
  const [slashActive, setSlashActive] = useState(0);
  /** SC-3: Escape dismisses the menu without deleting the typed /token. */
  const [slashDismissedKey, setSlashDismissedKey] = useState<string | null>(
    null,
  );
  const [projectFiles, setProjectFiles] = useState<MentionCandidate[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [voiceSending, setVoiceSending] = useState(false);
  /** Tracks auto-applied effort/pack/planFirst so clear can restore. */
  const [intentModeState, setIntentModeState] = useState<ComposerModeState>(
    emptyComposerModeState,
  );

  useEffect(() => {
    if (props.focusComposerToken == null) return;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, [props.focusComposerToken]);

  const applyAttachments = useCallback(
    (paths: string[]) => {
      // Functional merge so rapid paste/pick/mention cannot clobber chips.
      let error: string | undefined;
      props.onAttachments((prev) => {
        const r = addPathsToAttachments(prev as ClientAttachment[], paths);
        error = r.error;
        return r.items;
      });
      if (error === "max_attachments") {
        toast({
          description: t("composer.maxAttachments"),
          variant: "destructive",
        });
      } else if (error) {
        toast({ description: error, variant: "destructive" });
      }
    },
    [props.onAttachments, toast, t],
  );

  const dictation = useDictation({
    // LANG-2: STT language follows the active UI locale (short codes; main strips region).
    language: getActiveLocale(),
    signedIn: Boolean(props.auth?.signedIn),
    onAppend: (text) => props.onGoal(text),
    onAudioAttached: (path) => applyAttachments([path]),
    onAudioError: () =>
      toast({
        description: t("composer.attachFailed"),
        variant: "destructive",
      }),
  });

  useEffect(() => {
    if (!props.root?.trim()) {
      setProjectFiles([]);
      return;
    }
    let cancelled = false;
    void rpc<Array<{ name: string; path: string; isDir: boolean }>>(
      "workspace.listFiles",
      { root: props.root, max: 40 },
    )
      .then((list) => {
        if (cancelled) return;
        setProjectFiles(projectMentionCandidatesFromList(list));
      })
      .catch(() => {
        if (!cancelled) setProjectFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.root]);

  const mentionRoots = useMemo(
    () => (props.root?.trim() ? [props.root.trim()] : []),
    [props.root],
  );

  const mentionQuery = extractMentionQuery(props.goal, cursor);
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const attached: MentionCandidate[] = props.attachments.map((a) => ({
      path: a.sourcePath,
      name: a.name,
      group: "attached" as const,
    }));
    return filterMentionCandidates(
      [...attached, ...projectFiles],
      mentionQuery.query,
      8,
      mentionRoots,
    );
  }, [mentionQuery, props.attachments, projectFiles, mentionRoots]);

  const slashQuery = extractSlashQuery(props.goal, cursor);
  const slashMenuOpen = isSlashMenuVisible(
    slashQuery,
    slashDismissedKey,
    Boolean(mentionQuery),
  );
  const slashCandidates = useMemo(() => {
    if (!slashQuery || !slashMenuOpen) return [];
    return filterSlashCommands(slashQuery.token);
  }, [slashQuery, slashMenuOpen]);

  const selectMention = (item: MentionCandidate) => {
    if (!mentionQuery) return;
    const r = insertMentionToken(
      props.goal,
      cursor,
      mentionQuery.start,
      item.path,
      mentionRoots,
    );
    props.onGoal(r.text);
    setCursor(r.cursor);
    applyAttachments([item.path]);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(r.cursor, r.cursor);
      }
    });
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (!it.type.startsWith("image/")) continue;
      e.preventDefault();
      const blob = it.getAsFile();
      if (!blob) continue;
      try {
        const b64 = await blobToBase64(blob);
        const ext = imageExtFromMime(it.type);
        const p = await writeTempAttachment(
          `paste-${Date.now()}.${ext}`,
          b64,
        );
        if (p) applyAttachments([p]);
        else
          toast({
            description: t("composer.attachFailed"),
            variant: "destructive",
          });
      } catch {
        toast({
          description: t("composer.attachFailed"),
          variant: "destructive",
        });
      }
      return;
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paths = pathsFromDropFiles(
      Array.from(e.dataTransfer.files ?? []) as Array<{ path?: string }>,
    );
    if (paths.length) applyAttachments(paths);
  };

  const signedIn = Boolean(props.auth?.signedIn);
  const hasWorkspace = Boolean(props.root?.trim());

  // Phase 3 plain-language workflows (always available near composer; ranked).
  // Cap display at landing.maxRecommendedActions + a few extras (not noisy: compact pills).
  const workflowIntents = useMemo(
    () =>
      pickComposerIntents(
        { rolePackId: props.rolePackId, hasWorkspace },
        6,
      ),
    [props.rolePackId, hasWorkspace],
  );

  const activeIntent = findComposerIntent(props.composerIntentId ?? null);

  const applyIntentSelection = useCallback(
    (id: ComposerIntentId) => {
      const r = selectComposerIntent(intentModeState, id, {
        effort: props.effort,
        rolePackId: props.rolePackId,
        planFirst: Boolean(props.planFirst),
      });
      setIntentModeState(r.state);
      props.onComposerIntent?.(id);
      if (r.setEffort) props.onEffort(r.setEffort);
      if (r.setRolePackId !== undefined) props.onRolePack(r.setRolePackId);
      if (r.setPlanFirst !== undefined) props.onPlanFirst?.(r.setPlanFirst);
      const def = findComposerIntent(id);
      if (def?.needsWorkspace && !props.root?.trim()) {
        props.onPickRoot();
      }
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
      });
    },
    [
      intentModeState,
      props.effort,
      props.rolePackId,
      props.planFirst,
      props.onComposerIntent,
      props.onEffort,
      props.onRolePack,
      props.onPlanFirst,
      props.root,
      props.onPickRoot,
    ],
  );

  const clearIntentMode = useCallback(() => {
    const r = clearComposerIntent(intentModeState, {
      effort: props.effort,
      rolePackId: props.rolePackId,
      planFirst: Boolean(props.planFirst),
    });
    setIntentModeState(r.state);
    props.onComposerIntent?.(null);
    if (r.setEffort) props.onEffort(r.setEffort);
    if (r.setRolePackId !== undefined) props.onRolePack(r.setRolePackId);
    if (r.setPlanFirst !== undefined) props.onPlanFirst?.(r.setPlanFirst);
  }, [
    intentModeState,
    props.effort,
    props.rolePackId,
    props.planFirst,
    props.onComposerIntent,
    props.onEffort,
    props.onRolePack,
    props.onPlanFirst,
  ]);

  // Keep local mode state in sync when parent clears intent (e.g. after send).
  useEffect(() => {
    if (props.composerIntentId == null && intentModeState.intentId != null) {
      setIntentModeState(emptyComposerModeState());
    }
  }, [props.composerIntentId, intentModeState.intentId]);

  const homeRecentTasks = useMemo(() => {
    const recent = recentTasksForHomeDesk(props.tasks, 3);
    const labels = disambiguateScanTitles(
      recent.map((task) => ({
        id: task.id,
        scanTitle: preferredChatScanTitle({
          title: task.title,
          goal: task.goal,
        }),
        workspaceName: task.policySnapshot?.workspaceRoots?.[0] ?? null,
        updatedAt: task.updatedAt,
      })),
    );
    return recent.map((task) => ({
      task,
      scanTitle: labels.get(task.id) ?? task.goal,
    }));
  }, [props.tasks]);

  const intentIcon = (
    icon: (typeof workflowIntents)[number]["icon"],
  ): LucideIcon => {
    switch (icon) {
      case "pen":
        return PenLine;
      case "folder":
        return FolderKanban;
      case "image":
        return ImageIcon;
      case "search":
        return Search;
      case "calendar":
        return CalendarClock;
      case "sparkles":
      default:
        return Sparkles;
    }
  };

  // CMD-1/3: recognition-driven effort (not menu selection).
  const armed = useMemo(() => armedSlashCommand(props.goal), [props.goal]);
  const armedEffortRef = useRef<ArmedEffortState>({
    saved: null,
    applied: null,
  });
  useEffect(() => {
    const r = armedEffortTransition(
      armedEffortRef.current,
      props.effort,
      armed?.command.effort ?? null,
    );
    armedEffortRef.current = r.state;
    if (r.set) props.onEffort(r.set);
    // Only re-run when the armed command identity changes (arm/disarm/switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [armed?.command.id]);

  const applySlash = (cmd: SlashCommand) => {
    const slash = extractSlashQuery(props.goal, cursor);
    if (!slash) return;
    setSlashDismissedKey(null);
    if (cmd.kind === "fill") {
      // CMD-1: complete the token; template expands at send time.
      const r = applySlashCommand(props.goal, slash, `/${cmd.token} `);
      props.onGoal(r.text);
      setCursor(r.cursor);
      // /organize needs a folder; open the picker without blocking completion.
      if (cmd.id === "organize" && !props.root?.trim()) {
        props.onPickRoot();
      }
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(r.cursor, r.cursor);
        }
      });
      return;
    }
    // Clear the slash token, then run the side action.
    const r = applySlashCommand(props.goal, slash, "");
    props.onGoal(r.text);
    setCursor(r.cursor);
    if (cmd.action === "pickFolder") props.onPickRoot();
    else if (cmd.action === "openSchedule") props.onOpenScheduled?.();
    else if (cmd.action === "openTools") props.onOpenTools?.();
    else if (cmd.action === "openMemory") props.onOpenMemory();
    else if (cmd.action === "openRecipes") {
      const first = coworker.recipes[0];
      if (first) {
        props.onGoal(recipeGoalForComposer(first));
        toast({ description: t("home.usePlaybook") });
      } else {
        toast({ description: t("home.playbooksEmpty") });
      }
    } else if (cmd.action === "showBriefing") {
      toast({
        description:
          coworker.briefingLine || coworker.briefing.title,
      });
    } else if (cmd.action === "exportPack") {
      props.onOpenArtifacts?.();
    }
  };

  const runningTasks = props.tasks.filter(
    (t) =>
      isActiveTaskStatus(t.status),
  );
  // PROG-1: elapsed on the home running banner (single lead task).
  const leadRunning = runningTasks[0];
  const runningElapsedStart = leadRunning
    ? taskElapsedStartIso(leadRunning)
    : null;
  const runningElapsedSeconds = useElapsedSeconds(
    runningElapsedStart,
    Boolean(leadRunning),
  );
  const activeRoot = resolveHomeActiveRoot(props.root, props.tasks);
  // SH-15: render at most one needs-you notice row (was slice(0,3) then [0] only).
  const needsYou = (props.needsYouItems ?? []).slice(0, 1);
  const isFirstRun = props.tasks.length === 0;

  const coworker = useMemo(() => {
    const doneCount = props.tasks.filter((t) => t.status === "done").length;
    const working = props.tasks.filter((t) => isActiveTaskStatus(t.status));
    return buildCoworkerHomeModel({
      tasks: props.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        goal: t.goal,
        status: t.status,
        updatedAt: t.updatedAt,
      })),
      schedules: props.schedules.map((s) => ({
        id: s.id,
        name: s.name,
        enabled: Boolean(s.enabled),
        nextRunAt: (s as { nextRunAt?: string | null }).nextRunAt ?? null,
      })),
      inbox: (props.needsYouItems ?? []).map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        read: i.read,
      })),
      usage: {
        hasUsedQueue: false,
        scheduleCount: props.schedules.filter((s) => s.enabled).length,
        hasUsedBrowser: false,
        connectorCount: 0,
        memoryCount: props.memories.length,
        recipeCount: 0,
        hasExported: false,
        hasMultiTasked: working.length > 1,
        hasRemote: false,
        doneCount,
      },
    });
  }, [props.tasks, props.schedules, props.needsYouItems, props.memories]);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, []);

  // Persist home draft for session resume — including empty-draft clears so
  // deleted text does not resurrect after restart (Task 12).
  useEffect(() => {
    const draft = props.goal;
    const trimmed = draft.trim();
    const prev = loadWorkSession();
    const attachmentPaths = (props.attachments ?? [])
      .map((a) => a.sourcePath)
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .slice(0, 10);
    saveWorkSession(
      touchWorkSession(prev, {
        draft,
        draftCleared: trimmed.length === 0,
        surface: "home",
        workspaceRoot: props.root || null,
        conversationId: prev.conversationId,
        attachmentPaths,
      }),
    );
  }, [props.goal, props.root, props.attachments]);

  const offerPolish = shouldOfferGoalPolish(props.goal);
  const landing = useMemo(() => {
    const staleTasks = detectStaleWork(
      props.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        goal: t.goal,
        status: t.status,
        updatedAt: t.updatedAt,
      })),
      new Date(),
    );
    const recentDeliverables = rankRecentDeliverables(
      props.artifacts.map((a) => ({
        id: a.id,
        title: a.title,
        path: a.path,
        createdAt: (a as { createdAt?: string }).createdAt ?? "",
        taskId: (a as { taskId?: string }).taskId ?? null,
      })),
      3,
    );
    return planHomeLanding({
      workBoard: coworker.workBoard,
      resume: coworker.resume,
      recipes: coworker.recipes,
      discovery: coworker.discovery,
      recentDeliverables,
      staleTasks,
      hasNeedsYouNotice: needsYou.length > 0,
      hasRunningNotice: runningTasks.length > 0,
    });
  }, [
    coworker.workBoard,
    coworker.resume,
    coworker.recipes,
    coworker.discovery,
    props.tasks,
    props.artifacts,
    needsYou.length,
    runningTasks.length,
  ]);

  const deskBusy =
    Boolean(landing.attention) ||
    landing.showLiveWork ||
    needsYou.length > 0 ||
    runningTasks.length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden" data-testid="home-desk">
      <ScrollArea className="min-w-0 flex-1">
        {/* SH-15: drop inner fade — root view-transition already crossfades */}
        <div className="mx-auto w-full min-w-0 max-w-3xl px-4 sm:px-8 pb-16 pt-4">
          {props.draftRestoredNotice ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="draft-restored-notice"
              className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-2xs text-muted-foreground"
            >
              <span>{t("home.draftRestored")}</span>
              <button
                type="button"
                className="shrink-0 text-2xs font-medium text-foreground/80 underline-offset-2 hover:underline"
                onClick={() => props.onDismissDraftRestored?.()}
              >
                {t("home.resumeDismiss")}
              </button>
            </div>
          ) : null}
          {(() => {
            const homeNotices: NoticeItem[] = [];
            if (needsYou.length > 0) {
              homeNotices.push({
                id: "needs-you",
                kind: "needs_you",
                priority: noticePriority("needs_you"),
              });
            }
            if (runningTasks.length > 0) {
              homeNotices.push({
                id: "running",
                kind: "running",
                priority: noticePriority("running"),
              });
            }
            if (props.usageWarn) {
              homeNotices.push({
                id: "usage",
                kind: "usage",
                priority: noticePriority("usage"),
              });
            }
            const readinessBlocked =
              props.readinessItems != null &&
              isReadinessBlocked(props.readinessItems);
            const runtimeBlocked = Boolean(
              props.readinessItems?.some(
                (i) => i.id === "runtime" && i.status === "blocked",
              ),
            );
            return (
              <>
              {runtimeBlocked ? (
                <div className="mb-4" data-testid="home-runtime-install">
                  <RuntimeInstallStep
                    status={props.runtimeInstallStatus}
                    pending={props.runtimeInstallPending}
                    onCheck={props.onRuntimeInstallCheck}
                    onContinue={
                      props.onReadinessAction
                        ? () => props.onReadinessAction?.("install-runtime")
                        : undefined
                    }
                  />
                </div>
              ) : null}
              {readinessBlocked ? (
                <ReadinessChecklist
                  className="mb-4"
                  items={props.readinessItems!}
                  onAction={props.onReadinessAction}
                />
              ) : null}
              <NoticeSlot
                className="mb-6 space-y-3"
                notices={
                  readinessBlocked
                    ? homeNotices.filter(
                        (n) =>
                          n.kind === "needs_you" ||
                          n.kind === "gateway_dead" ||
                          n.kind === "gateway_reconnecting",
                      )
                    : homeNotices
                }
                maxVisible={2}
                render={(n) => {
                  if (n.kind === "needs_you") {
                    const item = needsYou[0]!;
                    return (
                      <div className="approval-arrive rounded-xl border border-warning/35 bg-warning/10 px-4 py-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-warning">
                            {t("inbox.needsYou")}
                          </div>
                          {props.onOpenInbox && (
                            <button
                              type="button"
                              className="text-xs font-medium text-warning/90 hover:text-warning"
                              onClick={props.onOpenInbox}
                            >
                              {t("inbox.viewAll")}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-background/40 px-2.5 py-1.5">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {item.title}
                            </div>
                            <div className="truncate text-2xs text-muted-foreground">
                              {t(`inbox.kind.${item.kind}`)}
                            </div>
                          </div>
                          {(() => {
                            const target = needsYouOpenTarget(item);
                            if (!target) return null;
                            return (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 shrink-0 border-warning/40 px-2.5 text-xs text-warning hover:bg-warning/15"
                                data-testid="needs-you-open"
                                data-task-id={target.taskId}
                                data-approval-id={
                                  target.approvalId ?? undefined
                                }
                                onClick={() =>
                                  props.onOpenTask(target.taskId, {
                                    approvalId: target.approvalId,
                                  })
                                }
                              >
                                {t("inbox.openTask")}
                              </Button>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  }
                  if (n.kind === "running") {
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ring/30 bg-ring/10 px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-ring">
                            {runningTasks.length === 1
                              ? t("home.stillWorkingOne")
                              : t("home.stillWorkingMany", {
                                  n: runningTasks.length,
                                })}
                            <span
                              className="ml-1.5 font-medium tabular-nums text-ring/80"
                              data-elapsed
                            >
                              · {formatElapsed(runningElapsedSeconds)}
                            </span>
                          </div>
                          <div className="truncate text-xs text-ring/90">
                            {runningTasks[0]!.goal}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-ring/35 bg-transparent"
                            onClick={() =>
                              props.onOpenTask(runningTasks[0]!.id)
                            }
                          >
                            {t("home.open")}
                          </Button>
                          {props.onCancelTask && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-ring/35 bg-transparent"
                              onClick={() =>
                                props.onCancelTask?.(runningTasks[0]!.id)
                              }
                            >
                              {t("home.stop")}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  }
                  if (n.kind === "usage" && props.usageWarn) {
                    const hard = props.usageWarn.level === "hard";
                    return (
                      <div
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 ${
                          hard
                            ? "border-destructive/30 bg-destructive/10"
                            : "border-warning/30 bg-warning/10"
                        }`}
                      >
                        <div
                          className={
                            hard
                              ? "text-sm text-destructive-text"
                              : "text-sm text-warning"
                          }
                        >
                          {hard
                            ? t("settings.usageChipHard", {
                                pct: props.usageWarn.pct,
                              })
                            : t("settings.usageChipSoft", {
                                pct: props.usageWarn.pct,
                              })}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className={
                            hard
                              ? "border-destructive/30 bg-transparent"
                              : "border-warning/30 bg-transparent"
                          }
                          onClick={() => props.onOpenUsage?.()}
                        >
                          {t("settings.usageOpenAccount")}
                        </Button>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              </>
            );
          })()}
          <div className="text-center">
            {/* SH-1: ~1.75rem hero so the composer is the visual anchor; frost title on midnight */}
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-display text-foreground">
              {props.greeting.title}
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground/90">
              {landing.useBriefingAsSubtitle && coworker.briefing.actionable
                ? coworker.briefingLine
                : props.greeting.subtitle}
            </p>
            <div
              className="mx-auto mt-3 h-px w-12 bg-gradient-to-r from-transparent via-primary/40 to-transparent"
              aria-hidden
            />
          </div>

          {/* Lean desk strips: one current-work band + at most one calm secondary (≤3 actions) */}
          {(landing.attention ||
            landing.showLiveWork ||
            landing.showRecipes ||
            landing.showDiscovery ||
            landing.showRecentDeliverables) && (
            <div
              className="mt-5 space-y-2.5"
              data-testid="home-current-work"
            >
              {landing.attention && (
                <div
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5",
                    landing.attention.kind === "needs_you" &&
                      "approval-arrive border-warning/35 bg-warning/10",
                    landing.attention.kind === "working" &&
                      "border-ring/30 bg-ring/10",
                    landing.attention.kind === "stuck" &&
                      "border-warning/30 bg-warning/10",
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {landing.attention.title}
                    </div>
                    {landing.attention.detail && (
                      <div className="truncate text-2xs text-muted-foreground">
                        {landing.attention.detail}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {landing.attention.taskId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() =>
                          props.onOpenTask(landing.attention!.taskId!)
                        }
                      >
                        {t("home.open")}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {landing.showLiveWork && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                  <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("home.workBoardTitle")}
                  </div>
                  <div className="space-y-0.5">
                    {landing.liveWorkItems.map((item) => (
                      <button
                        key={item.taskId}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/[0.04]"
                        onClick={() => props.onOpenTask(item.taskId)}
                      >
                        <span className="truncate">{item.title}</span>
                        <span
                          className={cn(
                            "shrink-0 text-2xs font-medium",
                            item.status === "needs_you"
                              ? "text-warning"
                              : "text-ring",
                          )}
                        >
                          {item.status === "needs_you"
                            ? t("inbox.needsYou")
                            : t("home.runningNow")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {landing.showRecipes && (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  data-testid="home-recommended-actions"
                  data-max-recommended={landing.maxRecommendedActions}
                >
                  <span className="mr-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("home.playbooksTitle")}
                  </span>
                  {landing.recipes.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-foreground/90 transition-colors hover:border-primary/35 hover:bg-primary/10"
                      onClick={() => {
                        const store = markRecipeUsed(loadRecipeStore(), r.id);
                        saveRecipeStore(store);
                        props.onGoal(recipeGoalForComposer(r));
                        focusComposer();
                      }}
                    >
                      {r.title}
                    </button>
                  ))}
                </div>
              )}

              {landing.showDiscovery && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {landing.discovery.map((hint) => (
                    <button
                      key={hint.id}
                      type="button"
                      className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.06]"
                      onClick={() => {
                        dismissDiscovery(hint.id);
                        if (hint.cta === "scheduled") props.onOpenScheduled?.();
                        else if (hint.cta === "memory") props.onOpenMemory();
                        else if (hint.cta === "settings_tools")
                          props.onOpenTools?.();
                        else if (hint.cta === "tasks") props.onOpenTasks();
                      }}
                    >
                      <div className="text-xs font-semibold leading-snug">
                        {t(hint.titleKey)}
                      </div>
                      <div className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                        {t(hint.bodyKey)}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {landing.showRecentDeliverables && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("home.recentDeliverablesTitle")}
                  </span>
                  {landing.recentDeliverables.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-foreground/90 transition-colors hover:border-primary/35 hover:bg-primary/10"
                      onClick={() => {
                        if (d.taskId) props.onOpenTask(d.taskId);
                        else props.onOpenArtifacts?.();
                      }}
                    >
                      {d.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Compose — simple: write → optional context → run */}
          <TooltipProvider delayDuration={400}>
            <div
              className={cn(
                "vt-compose glow-ring relative mt-9 rounded-2xl p-px",
                dragOver && "ring-2 ring-primary/40",
              )}
              data-testid="home-composer-drop"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="relative rounded-xl bg-card/90 p-4 sm:p-5">
                <ComposerAttachments
                  items={props.attachments as ClientAttachment[]}
                  onRemove={(id) =>
                    props.onAttachments((prev) =>
                      removeAttachment(prev as ClientAttachment[], id),
                    )
                  }
                />
                {mentionQuery && mentionCandidates.length > 0 && (
                  <FileMentionMenu
                    items={mentionCandidates}
                    activeIndex={Math.min(
                      mentionActive,
                      mentionCandidates.length - 1,
                    )}
                    onHover={setMentionActive}
                    onSelect={selectMention}
                    anchorRef={textareaRef}
                    caretIndex={cursor}
                    roots={mentionRoots}
                  />
                )}
                {slashMenuOpen && (
                  <SlashCommandMenu
                    items={slashCandidates}
                    activeIndex={Math.min(
                      slashActive,
                      Math.max(slashCandidates.length - 1, 0),
                    )}
                    onHover={setSlashActive}
                    onSelect={applySlash}
                    args={slashQuery?.args}
                    emptyHint={t("slash.noMatch")}
                  />
                )}
                {activeIntent ? (
                  <ArmedCommandChip
                    label={t(activeIntent.labelKey)}
                    effect={t(activeIntent.descKey)}
                    escalates={activeIntent.effort != null}
                    clearLabel={t("intent.chipClear")}
                    expandsHint={t("intent.expandsOnSend")}
                    onClear={clearIntentMode}
                  />
                ) : armed ? (
                  <ArmedCommandChip
                    label={t(armed.command.labelKey)}
                    effect={t(`slash.armedEffect.${armed.command.id}`)}
                    escalates={armed.command.effort != null}
                    clearLabel={t("slash.armedClear")}
                    expandsHint={t("slash.expandsOnSend")}
                    onClear={() => {
                      const next = stripArmedSlashPrefix(
                        props.goal,
                        armed.command.token,
                      );
                      props.onGoal(next);
                      setCursor(next.length);
                    }}
                  />
                ) : null}
                <Textarea
                  ref={textareaRef}
                  value={props.goal}
                  onChange={(e) => {
                    props.onGoal(e.target.value);
                    setCursor(e.target.selectionStart ?? e.target.value.length);
                    setSlashActive(0);
                  }}
                  onSelect={(e) =>
                    setCursor(
                      (e.target as HTMLTextAreaElement).selectionStart ?? 0,
                    )
                  }
                  onPaste={(e) => void onPaste(e)}
                  placeholder={
                    activeIntent
                      ? t("intent.placeholder")
                      : t("home.title")
                  }
                  aria-label={t("home.title")}
                  className="min-h-[112px] resize-none border-0 bg-transparent p-0.5 text-md leading-relaxed shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0"
                  onKeyDown={(e) => {
                    // SC-1: never handle keys while an IME composition is active.
                    if (e.nativeEvent.isComposing) return;
                    if (mentionQuery && mentionCandidates.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionActive(
                          (i) => (i + 1) % mentionCandidates.length,
                        );
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionActive(
                          (i) =>
                            (i - 1 + mentionCandidates.length) %
                            mentionCandidates.length,
                        );
                        return;
                      }
                      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        selectMention(
                          mentionCandidates[
                            Math.min(
                              mentionActive,
                              mentionCandidates.length - 1,
                            )
                          ]!,
                        );
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setCursor(cursor);
                        props.onGoal(
                          props.goal.slice(0, mentionQuery.start) +
                            props.goal.slice(cursor),
                        );
                        return;
                      }
                    }
                    // SC-3: Escape dismisses the menu; typed /token stays.
                    // SC-4: no-match state still dismisses on Escape, does not
                    // swallow Enter (falls through to send).
                    if (slashMenuOpen) {
                      if (slashCandidates.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setSlashActive(
                            (i) => (i + 1) % slashCandidates.length,
                          );
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setSlashActive(
                            (i) =>
                              (i - 1 + slashCandidates.length) %
                              slashCandidates.length,
                          );
                          return;
                        }
                        if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                          e.preventDefault();
                          applySlash(
                            slashCandidates[
                              Math.min(slashActive, slashCandidates.length - 1)
                            ]!,
                          );
                          return;
                        }
                        if (e.key === "Tab") {
                          e.preventDefault();
                          applySlash(
                            slashCandidates[
                              Math.min(slashActive, slashCandidates.length - 1)
                            ]!,
                          );
                          return;
                        }
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        if (slashQuery) {
                          setSlashDismissedKey(slashDismissKey(slashQuery));
                        }
                        return;
                      }
                    }
                    const action = composerKeyAction(
                      {
                        key: e.key,
                        shiftKey: e.shiftKey,
                        metaKey: e.metaKey,
                        ctrlKey: e.ctrlKey,
                        altKey: e.altKey,
                        isComposing: e.nativeEvent.isComposing,
                      },
                      { allowPlainEnterSend: true },
                    );
                    if (action.type === "send") {
                      e.preventDefault();
                      if (
                        props.starting ||
                        (!props.goal.trim() && !activeIntent)
                      )
                        return;
                      props.onRun(
                        undefined,
                        toTaskAttachments(
                          props.attachments as ClientAttachment[],
                        ),
                      );
                    }
                    // Shift+Enter: default newline behavior (do not preventDefault).
                  }}
                />

                {props.root && !isManagedWorkspacePath(props.root) ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    {/* Non-interactive pill wrapping two sibling buttons. A
                        nested button-in-button is invalid HTML and makes the
                        inner "clear" control unreachable / mis-announced for
                        keyboard and screen-reader users. */}
                    <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-2.5 pr-1 text-2xs text-muted-foreground transition-colors hover:border-white/[0.12]">
                      <button
                        type="button"
                        onClick={props.onPickRoot}
                        className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground"
                        title={props.root}
                      >
                        <FolderOpen className="h-3 w-3 shrink-0" />
                        <span className="truncate font-mono">
                          {shortPath(props.root)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-white/10 hover:text-foreground"
                        aria-label={t("home.clear")}
                        onClick={props.onClearRoot}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ) : null}

                {dragOver && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    {t("composer.dropHint")}
                  </p>
                )}
                {dictation.state === "listening" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("dictation.listening", {
                      text: dictation.interim || t("dictation.hintGrok"),
                    })}
                  </p>
                )}
                {dictation.state === "processing" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("dictation.processing")}
                  </p>
                )}
                {dictation.error && (
                  <p className="mt-2 text-xs text-destructive-text">
                    {dictation.error.startsWith("dictation.")
                      ? t(dictation.error)
                      : dictation.error}
                  </p>
                )}

                {/* One toolbar: context actions · role · run */}
                <div className="mt-3 flex items-center gap-1 border-t border-white/[0.05] pt-3">
                  <div className="flex min-w-0 flex-1 items-center gap-0.5">
                    <DictationButton
                      state={dictation.state}
                      level={dictation.level}
                      keepAudio={dictation.keepAudio}
                      keepAudioLabel={t("composer.keepAudio")}
                      onToggleKeepAudio={() =>
                        dictation.setKeepAudio(!dictation.keepAudio)
                      }
                      sending={voiceSending}
                      onClick={() => {
                        if (
                          dictation.state === "listening" &&
                          dictation.keepAudio
                        ) {
                          setVoiceSending(true);
                          setTimeout(() => setVoiceSending(false), 600);
                        }
                        void dictation.toggle(props.goal);
                      }}
                      title={
                        dictation.state === "listening" ||
                        dictation.state === "processing"
                          ? t("dictation.stop")
                          : t("dictation.start")
                      }
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            void pickFiles().then((paths) => {
                              if (paths.length) applyAttachments(paths);
                            })
                          }
                          aria-label={t("composer.attach")}
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {t("composer.attach")}
                      </TooltipContent>
                    </Tooltip>
                    {!props.root && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                            onClick={props.onPickRoot}
                            aria-label={t("home.pickFolder")}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {t("home.pickFolder")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {offerPolish && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 shrink-0 rounded-full px-2.5 text-2xs text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              const r = polishGoal(props.goal);
                              props.onGoal(r.polished);
                              toast({ description: t("home.polishApplied") });
                              focusComposer();
                            }}
                          >
                            {t("home.polishGoal")}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {t("home.polishGoal")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Popover>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 shrink-0 gap-1.5 rounded-full px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                              aria-label={t("home.runOptions")}
                            >
                              <Settings2 className="h-3.5 w-3.5 shrink-0" />
                              <span className="max-w-[9rem] truncate font-medium text-foreground/90">
                                {props.model}
                              </span>
                              <span className="hidden text-muted-foreground sm:inline">
                                ·
                              </span>
                              <span className="hidden sm:inline">
                                {effortLabel(props.effort)}
                              </span>
                            </Button>
                          </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {t("home.runOptions")}
                        </TooltipContent>
                      </Tooltip>
                      <PopoverContent
                        align="start"
                        side="top"
                        className="w-72 space-y-3 border-white/10 p-3"
                      >
                        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("home.runOptions")}
                        </p>
                        <div className="space-y-1.5">
                          <label className="text-2xs text-muted-foreground">
                            {t("home.model")}
                          </label>
                          <Select
                            value={props.model}
                            onValueChange={props.onModel}
                          >
                            <SelectTrigger className="h-9 w-full rounded-lg border-white/[0.08] bg-white/[0.03] text-xs shadow-none">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {props.models.map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-2xs text-muted-foreground">
                            {t("home.effort")}
                          </label>
                          <Select
                            value={
                              props.effort === "max" ? "heavy" : props.effort
                            }
                            onValueChange={(v) =>
                              props.onEffort(v as EffortLevel)
                            }
                          >
                            <SelectTrigger className="h-9 w-full rounded-lg border-white/[0.08] bg-white/[0.03] text-xs shadow-none">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fast">
                                {effortLabel("fast")}
                              </SelectItem>
                              <SelectItem value="normal">
                                {effortLabel("normal")}
                              </SelectItem>
                              <SelectItem value="heavy">
                                {effortLabel("heavy")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {props.onPlanFirst ? (
                          <div className="space-y-1.5">
                            <label className="text-2xs text-muted-foreground">
                              {t("home.planFirst")}
                            </label>
                            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs">
                              <input
                                type="checkbox"
                                className="rounded border-white/20"
                                checked={Boolean(props.planFirst)}
                                onChange={(e) =>
                                  props.onPlanFirst?.(e.target.checked)
                                }
                                data-plan-first-toggle
                              />
                              <span className="text-foreground/90">
                                {t("home.planFirstToggle")}
                              </span>
                            </label>
                          </div>
                        ) : null}
                        <div className="space-y-1.5">
                          <label className="text-2xs text-muted-foreground">
                            {t("home.approval")}
                          </label>
                          <Select
                            value={props.approvalMode}
                            onValueChange={(v) =>
                              props.onApprovalMode(
                                v as typeof props.approvalMode,
                              )
                            }
                          >
                            <SelectTrigger className="h-9 w-full rounded-lg border-white/[0.08] bg-white/[0.03] text-xs shadow-none">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="balanced">
                                {t("home.approvalBalanced")}
                              </SelectItem>
                              <SelectItem value="strict">
                                {t("home.approvalStrict")}
                              </SelectItem>
                              <SelectItem value="autopilot">
                                {t("home.approvalAutopilot")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {props.rolePacks.length > 0 && (
                    <RolePackPicker
                      packs={props.rolePacks}
                      value={props.rolePackId}
                      onChange={props.onRolePack}
                      variant="toolbar"
                    />
                  )}

                  <Button
                    disabled={
                      props.starting ||
                      (!props.goal.trim() && !activeIntent)
                    }
                    onClick={() =>
                      props.onRun(
                        undefined,
                        toTaskAttachments(
                          props.attachments as ClientAttachment[],
                        ),
                      )
                    }
                    className="h-9 shrink-0 gap-1.5 rounded-full px-4"
                    data-testid="home-run"
                  >
                    {props.starting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        {t("home.run")}
                        <span className="kbd border-primary-foreground/15 bg-primary-foreground/10 text-primary-foreground/75">
                          ↵
                        </span>
                      </>
                    )}
                  </Button>
                </div>
                <p className="mt-2 text-center text-2xs text-muted-foreground">
                  {t("home.composerHint")}
                </p>
              </div>
            </div>
          </TooltipProvider>

          {/* Phase 3 workflow intents — plain language, no slash; compact row.
              Prefer calm-desk budget (landing.showSmartStarts) so busy desks stay quiet;
              still show a short set when other secondaries claim the slot. */}
          {workflowIntents.length > 0 && (
            <section
              className="mt-5"
              data-testid="home-workflow-intents"
              data-home-recommended-actions={
                landing.showSmartStarts ? "true" : "secondary"
              }
              data-max-recommended={landing.maxRecommendedActions}
              aria-label={t("intent.workflows")}
            >
              <div className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("intent.workflows")}
              </div>
              <div
                className="flex flex-wrap gap-2"
                data-testid="composer-intent-chips"
              >
                {workflowIntents
                  .slice(
                    0,
                    landing.showSmartStarts
                      ? 6
                      : Math.max(landing.maxRecommendedActions, 3),
                  )
                  .map((idea) => {
                  const Icon = intentIcon(idea.icon);
                  const selected = props.composerIntentId === idea.id;
                  return (
                    <button
                      key={idea.id}
                      type="button"
                      data-testid={`intent-chip-${idea.id}`}
                      data-selected={selected ? "true" : "false"}
                      onClick={() => {
                        if (selected) clearIntentMode();
                        else applyIntentSelection(idea.id);
                      }}
                      className={intentChipMotionClass(selected)}
                    >
                      <Icon
                        className="h-3.5 w-3.5 text-primary/90"
                        strokeWidth={1.75}
                      />
                      {t(idea.labelKey)}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Continue — non-failed only; hide while needs-you / live work owns the desk */}
          {!isFirstRun && !deskBusy && homeRecentTasks.length > 0 && (
            <section className="mt-7" data-testid="home-recent-tasks">
              <SectionHeading
                title={t("home.recentTasks")}
                description={t("home.recentTasksDesc")}
                action={
                  <div className="flex items-center gap-2">
                    {homeRecentTasks[0] && (
                      <LinkAction
                        onClick={() =>
                          props.onOpenTask(homeRecentTasks[0]!.task.id)
                        }
                      >
                        {t("home.continueLast")}
                      </LinkAction>
                    )}
                    <LinkAction onClick={props.onOpenTasks}>
                      {t("nav.seeAll")}
                    </LinkAction>
                  </div>
                }
              />
              <div className="surface-quiet overflow-hidden shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
                {homeRecentTasks.map(({ task, scanTitle }, i) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => props.onOpenTask(task.id)}
                    title={task.goal}
                    aria-label={task.goal}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.035]",
                      i > 0 && "border-t border-white/[0.04]",
                    )}
                  >
                    <span className={statusDotClass(task.status)} />
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-foreground/90"
                      data-scan-title
                    >
                      {scanTitle}
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {taskStatusLabel(task.status)} ·{" "}
                      {relativeTime(task.updatedAt)}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </section>
          )}
          {/* SH-1: Pinned memories removed from Home — Memory nav + /memory cover it */}
        </div>
      </ScrollArea>

      {/* SH-3: rail workspace is read-only path + Reveal (composer chip owns pick) */}
      {/* SH-2/SH-4: hide Activity + empty rail on first-run */}
      {!isFirstRun && (
      <aside className="hidden w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/[0.05] bg-black/20 p-4 xl:flex">
        <HomeRailCard
          title={t("home.workspace")}
          icon={<FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />}
        >
          <div className="space-y-3">
            <div className="break-all font-mono text-2xs text-muted-foreground">
              {activeRoot ? shortPath(activeRoot) : t("home.noFolderChosen")}
            </div>
            {activeRoot && props.onRevealWorkspace && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => props.onRevealWorkspace?.(activeRoot)}
              >
                {t("home.revealFinder")}
              </Button>
            )}
          </div>
        </HomeRailCard>
      </aside>
      )}
    </div>
  );
}
