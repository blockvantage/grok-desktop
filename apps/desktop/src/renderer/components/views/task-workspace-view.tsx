import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOwnedConfirm } from "@/hooks/use-owned-confirm";
import {
  ArrowDown,
  FolderOpen,
  Loader2,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  ShieldAlert,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconTooltipButton } from "@/components/ui/icon-tooltip";
import {
  ChevronLeft as ChevronLeftIcon,
  Pause as PauseIcon,
  Send as SendIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArmedCommandChip,
  stripArmedSlashPrefix,
} from "@/components/armed-command-chip";
import { SlashCommandMenu } from "@/components/slash-command-menu";
// Media lightbox is interaction-gated (Task 17 lazy).
const MediaLightbox = lazy(() =>
  import("@/components/media-lightbox").then((m) => ({
    default: m.MediaLightbox,
  })),
);
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
import { fileName, pathKey } from "@/lib/workspace-file-preview";
import {
  DeliverableRow,
  FilePreviewBody,
  WorkspaceSection,
  type WorkspaceDeliverable,
} from "./task-workspace-parts";
import {
  buildDeliverablesFromArtifacts,
  groupDeliverables,
} from "@/lib/deliverables";
import { videoDisplaySrc } from "@/lib/media-src";
import { resolveChatRootId } from "@/lib/chat-root";
import {
  streamFingerprint as computeStreamFingerprint,
  shouldCelebrateDone,
} from "@/lib/stream-fingerprint";
import {
  attachedMentionCandidates,
  deliverableMentionCandidates,
  mentionRootsFromProjects,
  mergeProjectFileMentions,
} from "@/lib/mention-candidates";
import { isBusyTaskStatus, isTerminalTaskStatus } from "@/lib/task-terminal";
import {
  shouldPickFolderForSlash,
  slashSideAction,
} from "@/lib/slash-follow";
import {
  CELEBRATE_DONE_MS,
  toastForRevealResult,
} from "@/lib/reveal-result";
import {
  filterArtifactsForTasks,
  primaryWorkspaceRoot,
  projectWorkspaceRoots,
} from "@/lib/task-workspace-meta";
import { userFacingWorkspaceRoot } from "@/lib/managed-workspace";
import { isNearBottom } from "@/lib/scroll-near-bottom";
import { autoGrowComposerHeightPx } from "@/lib/composer-auto-height";
import {
  failedTextPreview,
  previewLoadErrorContent,
} from "@/lib/preview-load-error";
import {
  filePathsFromDropFiles,
  isFollowUpSendDisabled,
  isOptimisticTaskId,
  resolveFollowUpSubmit,
} from "@/lib/follow-up-submit";
import { weaveFollowUpComposerGoal } from "@/lib/create-task-optimistic";
import { filterFollowUpActions } from "@/lib/follow-up-actions-filter";
import {
  blocksFromCollapsed,
  hasPendingQuestionChips,
} from "@/lib/pending-question";
import {
  attachmentPathsForQueue,
  followUpPlaceholderKey,
  followUpPrimaryAction,
} from "@/lib/follow-up-primary-action";
import { planEnqueueRejectionFeedback } from "@/lib/queue-row-presentation";
import { freezePlaceholderKey } from "@/lib/frozen-placeholder";
import {
  clearFollowUpDraft,
  loadFollowUpDraft,
  saveFollowUpDraft,
} from "@/lib/follow-up-drafts";
import {
  getLastSeenSeq,
  markTaskSeen,
  maxBlockSeq,
  unreadBoundarySeq,
} from "@/lib/unread-boundary";
import {
  browserChatColumnFlexClass,
  browserChatColumnStyle,
} from "@/lib/browser-chat-column-style";
import {
  exportChatErrorIntent,
  exportChatSuccessIntent,
  imagineGoalFromTask,
} from "@/lib/export-chat-result";
import {
  firstArtifactPath,
  resolveNextActionEffect,
} from "@/lib/next-action-handlers";
import {
  loadRecipeStore,
  saveRecipe,
  saveRecipeStore,
} from "@/lib/task-recipes";
import {
  prepareCopyLastResponse,
} from "@/lib/copy-last-response";
import { planDeliverablePack } from "@/lib/deliverable-pack";
import {
  buildSmartRetryGoal,
  extractFailureMessage,
  shouldOfferSmartRetry,
} from "@/lib/smart-retry";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  rpc,
  revealPath,
  readAsset,
  assetDisplaySrc,
  isImagePath,
  isVideoPath,
  browserSetBounds,
  browserSetVisible,
  browserOnStatus,
  browserGetStatus,
  exportChatMarkdown,
  openBilling,
  pickFiles,
  writeTempAttachment,
  type BrowserStatusDto,
} from "@/lib/api";
import { TaskOverflowMenu } from "@/components/chat-actions-menu";
import { WorkspaceAuditDrawer } from "@/components/audit-drawer";
import { DictationButton } from "@/components/dictation-button";
import { useDictation } from "@/hooks/use-dictation";
import { getActiveLocale } from "@/i18n/active";
import { ComposerAttachments } from "@/components/composer-attachments";
import { FileMentionMenu } from "@/components/file-mention-menu";
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
  initialBrowserUiState,
  reduceBrowserUi,
  isBrowserToolPayload,
  statusShowsBrowserActivity,
  streamHasSuccessfulBrowserOpen,
} from "@/lib/browser-ui";
import {
  browserGlobeState,
  browserProviderReceipt,
  initialBrowserCapability,
  mayUseExternalBrowser,
  reduceBrowserCapability,
  type BrowserCapability,
} from "@/lib/browser-capability";
import {
  chatSplitPctFromPointer,
  DEFAULT_CHAT_SPLIT_PCT,
  showDeliverablesRail,
} from "@/lib/browser-split";
import { BrowserGlobe } from "@/components/browser-globe";
// Agent browser pane is interaction-gated (Task 17 lazy).
const BrowserPaneSlot = lazy(() =>
  import("@/components/browser-pane-slot").then((m) => ({
    default: m.BrowserPaneSlot,
  })),
);
// QueuedMessageRow is rendered inside ConversationOutbox (Task 16 extract).
import { DesktopControlHud } from "@/components/desktop-control-hud";
import {
  projectConversation,
  type ConversationTurn,
} from "@/lib/conversation-projector";
import {
  beginApprovalBusy,
  endApprovalBusy,
  type ApprovalActionTarget,
  type ApprovalBusyState,
} from "@/lib/approval-action";
import { approvalIdFromPendingEvent } from "@/lib/pending-approval-id";
import {
  exposedRevisionEditTaskId,
  revisionDraft,
  revisionIntent,
} from "@/lib/turn-revision";
import {
  beginRevisionSession,
  cancelRevisionSession,
  revisionSessionEligibility,
  revisionSubmitIntent,
  type RevisionEditSession,
} from "@/lib/revision-edit-session";
import { newRevisionMutationId } from "@/lib/turn-revision";
import type { ConversationOutboxController } from "@/hooks/use-conversation-outbox";
type WorkspaceQueueController = ConversationOutboxController;
import {
  layoutForConversation,
  loadLayoutStore,
  saveLayoutStore,
  setLayoutForConversation,
  shouldRestoreBrowserOpen,
} from "@/lib/workspace-layout";
import {
  pickFollowUpActions,
  type FollowUpAction,
} from "@/lib/follow-up-actions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  TaskStream,
  type StreamDensity,
  type TaskStreamHandle,
} from "@/components/task-stream";
import { EventHistoryBanner } from "@/components/conversation/event-history-banner";
import { StatusPill } from "@/components/status-pill";
import { activityStoreFromEvents } from "@/lib/events-to-activity";
import { useToast } from "@/components/ui/toast";
import { humanizeError } from "@/lib/errors";
import { relativeTime, shortPath, formatDateTime } from "@/lib/format";
import { approvalLabel, effortLabel } from "@/lib/labels";
import { ComposerRunOptions } from "@/components/composer-run-options";
import { MediaStudioControls } from "@/components/media-studio-controls";
import { RolePackPicker } from "@/components/role-pack-picker";
import {
  nextReplyWillUseParams,
  projectNextReplyPreview,
} from "@/lib/next-reply-preview";
import { ContextMeter } from "@/components/context-meter";
import { SessionStatusHeader } from "@/components/session-status-header";
import { WorkflowRunPanel } from "@/components/conversation/workflow-run-panel";
import { WatchUntilPanel } from "@/components/conversation/watch-until-panel";
import { ProtectionChip } from "@/components/protection-chip";
import { DegradedModeLabel } from "@/components/degraded-mode-label";
import { ReviewChangesStrip } from "@/components/review-changes-strip";
import { ConversationOutbox } from "@/components/conversation/conversation-outbox";
import { ConversationComposer } from "@/components/conversation/conversation-composer";
import { ConversationStatus } from "@/components/conversation/conversation-status";
import {
  projectProtectionChip,
  protectionFromEvents,
  protectionInputFromTask,
} from "@/lib/protection-chip";
import { projectDegradedModeView } from "@/lib/degraded-mode-ui";
import { projectGoalProgress } from "@/lib/goal-progress";
import {
  applyReviewFileAction,
  projectReviewChanges,
  type ReviewChangesView,
} from "@/lib/review-changes";
import { projectHelpersHud } from "@/lib/helpers-hud";
import {
  taskContextUsage,
  taskCompact,
  taskInterject,
  taskRewindPoints,
  taskRewind,
} from "@/lib/api";
import {
  foldWorkflowRun,
  foldWatchUntil,
  watchUntilStopPrompt,
  latestSessionStatusFromEvents,
  mapTurnToRewindPoint,
  MEDIA_DURATION_DEFAULT,
  mediaKindFromTokens,
  projectSessionStatusHeader,
  stillImagePathFromAttachments,
  workflowControlPrompt,
  type MediaStudioOptions,
} from "@grokdesk/shared";
import { collapseEventsToBlocks, extractResultSummary } from "@/lib/stream-view";
import { questionChipsForTerminalTurn } from "@/lib/user-question";
import { cn } from "@/lib/utils";
import {
  isActiveTaskStatus,
  type Artifact,
  type EffortLevel,
  type Task,
  type TaskAttachment,
  type TaskEvent,
} from "@grokdesk/shared";
import { useT } from "@/i18n";

type Deliverable = WorkspaceDeliverable;

type TextPreview = {
  path: string;
  name: string;
  content: string;
  truncated: boolean;
};

export function TaskWorkspaceView(props: {
  task: Task;
  chatTitle: string;
  events: TaskEvent[];
  eventsByTask: Record<string, TaskEvent[]>;
  /** True while history is fetching — show logo loader, not empty state. */
  eventsLoading?: boolean;
  /** AC4: history fetch failed — cache may still be shown as stale. */
  eventsError?: string | null;
  /** AC4: ISO timestamp when cached events became stale after a failed refresh. */
  eventsStaleSince?: string | null;
  /** AC4: paging hit safety budget before full history. */
  eventsTruncated?: boolean;
  /** AC4: immediate retry of open conversation events. */
  onRetryEvents?: () => void;
  artifacts: Artifact[];
  pendingApproval: TaskEvent | null;
  /**
   * I10: deep-link focus target for a parked approval (from needs-you open).
   * Cleared via onFocusApprovalConsumed after focus attempt.
   */
  focusApprovalId?: string | null;
  onFocusApprovalConsumed?: () => void;
  /** All tasks in the open chat (for subagent HUD). */
  threadTasks?: Task[];
  onFocusTask?: (taskId: string) => void;
  onBackToList: () => void;
  onHome: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onCancel: () => void;
  onApprove: (target: ApprovalActionTarget) => void | Promise<void>;
  onReject: (target: ApprovalActionTarget) => void | Promise<void>;
  onFollowUp?: (
    goal: string,
    attachments?: TaskAttachment[],
    clientMutationId?: string,
    revisionOfTaskId?: string,
  ) => void | Promise<boolean | void>;
  queueController: WorkspaceQueueController;
  /** True while a follow-up create is in flight. */
  followUpBusy?: boolean;
  /**
   * Engine ready for durable outbox enqueue. When false, composer shows
   * offline action copy and rejections keep the draft (Task 13).
   */
  engineReady?: boolean;
  signedIn?: boolean;
  onSignIn?: () => void;
  onOpenSettings?: () => void;
  onRememberTakeaways?: (taskId: string) => void;
  onRememberText?: (input: {
    taskId: string;
    text: string;
    goal?: string;
  }) => void | Promise<void>;
  onImagineFromTask?: (taskId: string, goal: string) => void;
  /** Jump to schedules with a pre-filled goal template. */
  onScheduleFromTask?: (goal: string) => void;
  /** Workspace root for /organize (SC-2 / SC-8). */
  root?: string;
  onPickRoot?: () => void;
  onOpenScheduled?: () => void;
  onOpenTools?: () => void;
  onOpenMemory?: () => void;
  /** Current form effort (for recognition-driven escalation restore). */
  effort?: EffortLevel;
  onEffort?: (v: EffortLevel) => void;
  model?: string;
  models?: string[];
  onModel?: (v: string) => void;
  approvalMode?: import("@grokdesk/shared").ApprovalMode;
  onApprovalMode?: (v: import("@grokdesk/shared").ApprovalMode) => void;
  planFirst?: boolean;
  onPlanFirst?: (v: boolean) => void;
  rolePacks?: import("@grokdesk/shared").RolePack[];
  rolePackId?: string | null;
  onRolePack?: (id: string | null) => void;
}) {
  const t = useT();
  const ownedConfirm = useOwnedConfirm();
  const { toast } = useToast();
  const { task } = props;
  const [takeawaysDismissed, setTakeawaysDismissed] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [mediaStudio, setMediaStudio] = useState<MediaStudioOptions>({
    kind: "video",
    durationSec: MEDIA_DURATION_DEFAULT,
  });
  /** One-shot adjacent composer error (Task 13); not a toast spam path. */
  const [composerEnqueueError, setComposerEnqueueError] = useState<string | null>(
    null,
  );
  const [followAttachments, setFollowAttachments] = useState<
    ClientAttachment[]
  >([]);
  const [editingRevision, setEditingRevision] =
    useState<RevisionEditSession | null>(null);
  /** CHAT-6: freeze user bubble while an inline revision is regenerating. */
  const [regeneratingTaskId, setRegeneratingTaskId] = useState<string | null>(
    null,
  );
  const [followFocused, setFollowFocused] = useState(false);
  const [frozenPlaceholderKey, setFrozenPlaceholderKey] = useState<
    string | null
  >(null);
  const [followCursor, setFollowCursor] = useState(0);
  const [mentionActive, setMentionActive] = useState(0);
  const [slashActive, setSlashActive] = useState(0);
  const [slashDismissedKey, setSlashDismissedKey] = useState<string | null>(
    null,
  );
  const [projectFiles, setProjectFiles] = useState<MentionCandidate[]>([]);
  const [voiceSending, setVoiceSending] = useState(false);
  const [followDragOver, setFollowDragOver] = useState(false);
  const followInputRef = useRef<HTMLTextAreaElement>(null);
  // CH-1: auto-grow follow-up composer up to ~8 rows.
  useEffect(() => {
    const el = followInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${autoGrowComposerHeightPx(el.scrollHeight)}px`;
  }, [followUp]);
  const isOptimistic = isOptimisticTaskId(task.id);

  const applyFollowAttachments = useCallback(
    (paths: string[]) => {
      setFollowAttachments((prev) => {
        const { items, error } = addPathsToAttachments(prev, paths);
        if (error === "max_attachments") {
          toast({
            description: t("composer.maxAttachments"),
            variant: "destructive",
          });
        } else if (error) {
          toast({ description: error, variant: "destructive" });
        }
        return items;
      });
    },
    [toast, t],
  );

  const dictation = useDictation({
    // LANG-2: STT language follows the active UI locale (short codes; main strips region).
    language: getActiveLocale(),
    signedIn: Boolean(props.signedIn),
    onAppend: (text) => setFollowUp(text),
    onAudioAttached: (path) => applyFollowAttachments([path]),
    onAudioError: () =>
      toast({
        description: t("composer.attachFailed"),
        variant: "destructive",
      }),
  });
  const arts = filterArtifactsForTasks(
    props.artifacts,
    (props.threadTasks ?? [task]).map((threadTask) => threadTask.id),
  );
  const root = primaryWorkspaceRoot(task);
  const projectRoots = projectWorkspaceRoots(task);
  // Only surface a path when the user chose a working dir — not the
  // auto-generated GrokDesk/workspaces folder.
  const displayWorkspaceRoot = userFacingWorkspaceRoot(
    task.policySnapshot?.workspaceRoots,
  );
  const isTerminal = isTerminalTaskStatus(task.status);
  const isLive = isActiveTaskStatus(task.status);
  // Queue a follow-up ONLY while the agent is actively producing a turn.
  // When it is idle-awaiting-user (waiting_user/approval/blocked) the reply
  // must send straight through — that is the input the agent is waiting for.
  const agentBusy = isBusyTaskStatus(task.status);
  const livePlaceholderKey = followUpPlaceholderKey({ isTerminal, isLive });
  const frozenPlaceholder = freezePlaceholderKey({
    liveKey: livePlaceholderKey,
    focused: followFocused,
    valueNonEmpty: followUp.trim().length > 0,
    frozenKey: frozenPlaceholderKey,
  });
  useEffect(() => {
    setFrozenPlaceholderKey(frozenPlaceholder.nextFrozenKey);
  }, [frozenPlaceholder.nextFrozenKey]);
  // Clear regenerating freeze once the follow-up is no longer busy.
  useEffect(() => {
    if (!props.followUpBusy) setRegeneratingTaskId(null);
  }, [props.followUpBusy]);
  // PROG-4: header caption from the same progressive activity model as the stream.
  const headerActivityStore = useMemo(
    () =>
      activityStoreFromEvents(
        props.events as Array<{
          id: string;
          kind: string;
          payload: Record<string, unknown>;
          createdAt?: string;
          taskId?: string;
        }>,
        task.id,
      ),
    [props.events, task.id],
  );
  const headerActivityCaption = isLive
    ? headerActivityStore.liveSummary
    : null;
  // C1: Working toward… from goal events or task goal fallback
  const goalProgress = useMemo(
    () =>
      projectGoalProgress({
        events: props.events.map((e) => ({
          kind: e.kind,
          payload: e.payload,
        })),
        taskGoal: task.goal,
        terminal: isTerminal,
        allowTaskGoalFallback: isLive || !isTerminal,
        // Terminal tasks: do not keep present-tense "Saved … under path" claims
        // when local assets may have been cleaned up.
        softenSavedClaims: isTerminal,
      }),
    // t: goal-progress lines use module-level t()
    [props.events, task.goal, isLive, isTerminal, t],
  );
  const workflowRun = useMemo(
    () =>
      foldWorkflowRun(
        props.events.map((e) => ({ kind: e.kind, payload: e.payload })),
      ),
    [props.events],
  );
  const watchUntil = useMemo(
    () =>
      foldWatchUntil(
        props.events.map((e) => ({
          kind: e.kind,
          title:
            typeof e.payload?.title === "string" ? e.payload.title : undefined,
          payload: e.payload,
        })),
      ),
    [props.events],
  );
  // C2: file-level review strip from write/edit events
  const reviewChangesBase = useMemo(
    () =>
      projectReviewChanges(
        props.events.map((e) => ({ kind: e.kind, payload: e.payload })),
      ),
    [props.events],
  );
  const [reviewOverride, setReviewOverride] = useState<ReviewChangesView | null | undefined>(
    undefined,
  );
  const [reviewDismissed, setReviewDismissed] = useState(false);
  useEffect(() => {
    setReviewDismissed(false);
    setReviewOverride(undefined);
  }, [task.id, reviewChangesBase?.files.map((f) => f.path).join("|")]);
  const reviewChanges =
    reviewOverride === undefined ? reviewChangesBase : reviewOverride;
  // C4: helpers only from truthful worker records (never parentTaskId)
  const helpersHud = useMemo(() => {
    const workers = Object.values(headerActivityStore.workers ?? {});
    return projectHelpersHud({
      workers,
      workersAvailable: headerActivityStore.workersAvailable !== false,
    });
  }, [headerActivityStore]);
  const [contextUsage, setContextUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
  } | null>(null);
  const [compactAvailable, setCompactAvailable] = useState(false);
  const acpSessionStatus = useMemo(
    () =>
      latestSessionStatusFromEvents(
        props.events.map((e) => ({ kind: e.kind, payload: e.payload })),
      ),
    [props.events],
  );
  const liveAcpStatus = Boolean(acpSessionStatus);

  // ACP SessionStatus is push-based (zero polling). Headless keeps the 8s meter.
  useEffect(() => {
    if (isOptimistic || !task.id) return;
    if (liveAcpStatus) {
      setCompactAvailable(true);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const usage = await taskContextUsage(task.id);
        if (!cancelled) {
          setContextUsage(usage);
          setCompactAvailable(Boolean(usage?.contextWindow));
        }
      } catch {
        if (!cancelled) setContextUsage(null);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 8_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [task.id, isOptimistic, task.status, liveAcpStatus]);
  // CH-8: suppress "What next?" while multi-choice question chips are pending.
  const hasPendingQuestion = useMemo(() => {
    const blocks = blocksFromCollapsed(
      collapseEventsToBlocks(props.events) as Array<{
        kind: string;
        id: string;
        text?: unknown;
      }>,
    );
    return hasPendingQuestionChips({
      isTerminal,
      isLive,
      hasFollowUp: Boolean(props.onFollowUp),
      blocks,
      taskStatus: task.status,
      questionChips: questionChipsForTerminalTurn as (
        b: typeof blocks,
        s: string,
      ) => unknown,
    });
  }, [isTerminal, isLive, props.onFollowUp, props.events, task.status]);

  // Prefer thread-aware root; queue is durable by conversation, not turn id.
  const conversationId = resolveChatRootId(task, props.threadTasks);

  // CHAT-2: restore per-conversation follow-up draft when opening a task.
  // Keyed by conversation root so drafts survive follow-up turn replacement.
  const draftHydratedFor = useRef<string | null>(null);
  const draftSkipSaveOnce = useRef(false);
  /** After successful send/enqueue, suppress the next effect flush of pre-clear text. */
  const draftSuppressPersist = useRef(false);
  const draftLatestRef = useRef({
    conversationId: "" as string,
    text: "",
    attachmentPaths: [] as string[],
    isOptimistic: false,
    editingRevision: false as boolean,
  });
  draftLatestRef.current = {
    conversationId: conversationId ?? "",
    text: followUp,
    attachmentPaths: followAttachments.map((a) => a.sourcePath),
    isOptimistic,
    editingRevision: Boolean(editingRevision),
  };

  useEffect(() => {
    if (!conversationId || isOptimistic) return;
    if (draftHydratedFor.current === conversationId) return;
    draftHydratedFor.current = conversationId;
    draftSkipSaveOnce.current = true;
    draftSuppressPersist.current = false;
    const draft = loadFollowUpDraft(conversationId);
    if (!draft) {
      setFollowUp("");
      setFollowAttachments([]);
      return;
    }
    setFollowUp(draft.text);
    setFollowAttachments(
      draft.attachmentPaths.length
        ? addPathsToAttachments([], draft.attachmentPaths).items
        : [],
    );
  }, [conversationId, isOptimistic]);

  // CHAT-2: persist as you type (debounced), flush on change so nav keeps keystrokes.
  useEffect(() => {
    if (!conversationId || isOptimistic || editingRevision) return;
    if (draftHydratedFor.current !== conversationId) return;
    if (draftSkipSaveOnce.current) {
      draftSkipSaveOnce.current = false;
      return;
    }
    if (draftSuppressPersist.current) {
      draftSuppressPersist.current = false;
      return;
    }
    const id = conversationId;
    const text = followUp;
    const attachmentPaths = followAttachments.map((a) => a.sourcePath);
    const handle = setTimeout(() => {
      saveFollowUpDraft(id, { text, attachmentPaths });
    }, 400);
    return () => {
      clearTimeout(handle);
      if (draftSuppressPersist.current) return;
      saveFollowUpDraft(id, { text, attachmentPaths });
    };
  }, [
    conversationId,
    followUp,
    followAttachments,
    isOptimistic,
    editingRevision,
  ]);

  // Final flush on unmount.
  useEffect(() => {
    return () => {
      if (draftSuppressPersist.current) return;
      const cur = draftLatestRef.current;
      if (!cur.conversationId || cur.isOptimistic || cur.editingRevision) return;
      saveFollowUpDraft(cur.conversationId, {
        text: cur.text,
        attachmentPaths: cur.attachmentPaths,
      });
    };
  }, []);

  const clearComposerDraft = useCallback(() => {
    draftSuppressPersist.current = true;
    if (conversationId) clearFollowUpDraft(conversationId);
  }, [conversationId]);

  const {
    messageQueue,
    enqueue: enqueueQueued,
    enqueueAsync,
    remove: removeQueued,
    retry: retryQueued,
    interjectNow,
    interjectingIds,
    sendNowSupported,
    editAndSendNow: editAndSendQueuedNow,
    edit: editQueued,
  } = props.queueController;
  const sendQueuedNow = useCallback(
    (item: (typeof messageQueue)[number]) => {
      // Send now is interjection only. If unsupported, keep the item queued —
      // never create a concurrent follow-up as fallback.
      if (sendNowSupported === false) return;
      void interjectNow(item);
    },
    [interjectNow, sendNowSupported],
  );
  const conversation = useMemo(() => {
    const tasks = props.threadTasks?.length ? props.threadTasks : [task];
    const artifactsByTask: Record<string, Artifact[]> = {};
    for (const threadTask of tasks) {
      artifactsByTask[threadTask.id] = [];
    }
    for (const artifact of props.artifacts) {
      (artifactsByTask[artifact.taskId] ??= []).push(artifact);
    }
    return projectConversation({
      conversationId,
      title: props.chatTitle,
      tasks,
      eventsByTask: props.eventsByTask,
      artifactsByTask,
      queued: messageQueue,
    });
  }, [
    conversationId,
    messageQueue,
    props.artifacts,
    props.chatTitle,
    props.events,
    props.eventsByTask,
    props.threadTasks,
    task,
  ]);
  const latestAcceptedTaskId = conversation.turns.at(-1)?.taskId ?? null;
  const revisionEligibilityTaskId = (() => {
    const latest = conversation.turns.at(-1);
    if (!latest) return null;
    return revisionIntent(latest, latestAcceptedTaskId).allowed
      ? latest.taskId
      : null;
  })();
  const editableTaskId = exposedRevisionEditTaskId(
    revisionEligibilityTaskId,
    Boolean(editingRevision),
  );

  // CHAT-4: freeze unread boundary once history is ready for this conversation.
  const conversationEvents = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ seq: number; taskId?: string; id?: string }> = [];
    for (const list of Object.values(props.eventsByTask)) {
      if (!list) continue;
      for (const ev of list) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        out.push(ev);
      }
    }
    for (const ev of props.events) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push(ev);
    }
    out.sort((a, b) => a.seq - b.seq);
    return out;
  }, [props.events, props.eventsByTask]);

  const [frozenUnread, setFrozenUnread] = useState<{
    conversationId: string;
    boundarySeq: number | null;
  } | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    if (props.eventsLoading) return;
    if (frozenUnread?.conversationId === conversationId) return;
    const lastSeen = getLastSeenSeq(conversationId);
    setFrozenUnread({
      conversationId,
      boundarySeq: unreadBoundarySeq(lastSeen, conversationEvents),
    });
  }, [
    conversationId,
    conversationEvents,
    frozenUnread?.conversationId,
    props.eventsLoading,
  ]);

  // Mark max seen when leaving this conversation (separator clears next open if caught up).
  const maxSeqByConversationRef = useRef<Record<string, number>>({});
  if (conversationId) {
    maxSeqByConversationRef.current[conversationId] =
      maxBlockSeq(conversationEvents);
  }
  useEffect(() => {
    if (!conversationId) return;
    const id = conversationId;
    return () => {
      const max = maxSeqByConversationRef.current[id] ?? 0;
      if (max > 0) markTaskSeen(id, max);
    };
  }, [conversationId]);

  const openUnreadBoundarySeq =
    frozenUnread?.conversationId === conversationId
      ? frozenUnread.boundarySeq
      : null;

  const firstUnreadTurnId = useMemo(() => {
    if (openUnreadBoundarySeq == null) return null;
    for (const turn of conversation.turns) {
      const list = props.eventsByTask[turn.taskId] ?? [];
      if (list.some((ev) => ev.seq >= openUnreadBoundarySeq)) {
        return turn.id;
      }
    }
    return null;
  }, [
    conversation.turns,
    openUnreadBoundarySeq,
    props.eventsByTask,
  ]);

  const beginRevisionEdit = (turn: ConversationTurn) => {
    if (editingRevision) return;
    const draft = revisionDraft(turn, latestAcceptedTaskId);
    if (!draft.allowed) return;
    setEditingRevision(beginRevisionSession({
      conversationId,
      sourceTaskId: draft.sourceTaskId,
      initialText: draft.initialText,
      attachments: draft.attachments,
      previousText: followUp,
      previousAttachments: followAttachments.map((attachment) => ({
        ...attachment,
      })),
      createMutationId: newRevisionMutationId,
    }));
    setFollowUp(draft.initialText);
    setFollowAttachments(draft.attachments);
    requestAnimationFrame(() => {
      followInputRef.current?.focus();
      followInputRef.current?.setSelectionRange(
        draft.initialText.length,
        draft.initialText.length,
      );
    });
  };

  /** CHAT-6: inline Save on the user bubble creates a revision follow-up. */
  const saveConversationTurnEdit = (
    turn: ConversationTurn,
    text: string,
  ) => {
    const draft = revisionDraft(turn, latestAcceptedTaskId);
    if (!draft.allowed) {
      toast({ description: t("conversation.editInvalidated") });
      return;
    }
    const next = text.trim();
    if (!next || !props.onFollowUp) return;
    const session = beginRevisionSession({
      conversationId,
      sourceTaskId: draft.sourceTaskId,
      initialText: next,
      attachments: draft.attachments,
      previousText: followUp,
      previousAttachments: followAttachments.map((attachment) => ({
        ...attachment,
      })),
      createMutationId: newRevisionMutationId,
    });
    const intent = revisionSubmitIntent(session, {
      conversationId,
      editableTaskId: revisionEligibilityTaskId,
    });
    if (!intent.allowed) {
      toast({ description: t("conversation.editInvalidated") });
      return;
    }
    setRegeneratingTaskId(turn.taskId);
    void Promise.resolve(
      props.onFollowUp(
        next,
        draft.attachments,
        intent.clientMutationId,
        intent.revisionOfTaskId,
      ),
    ).then((ok) => {
      if (ok === false) {
        setRegeneratingTaskId(null);
      }
    });
  };

  const cancelRevisionEdit = () => {
    if (!editingRevision) return;
    const restored = cancelRevisionSession(editingRevision);
    setFollowUp(restored.text);
    setFollowAttachments(restored.attachments);
    setEditingRevision(null);
    requestAnimationFrame(() => followInputRef.current?.focus());
  };

  useEffect(() => {
    if (!editingRevision) return;
    if (
      revisionSessionEligibility(editingRevision, {
        conversationId,
        editableTaskId: revisionEligibilityTaskId,
      }) === "eligible"
    ) {
      return;
    }
    const restored = cancelRevisionSession(editingRevision);
    setFollowUp(restored.text);
    setFollowAttachments(restored.attachments);
    setEditingRevision(null);
    toast({ description: t("conversation.editInvalidated") });
  }, [
    conversationId,
    revisionEligibilityTaskId,
    editingRevision,
    t,
    toast,
  ]);

  // Reset post-run takeaways when task changes.
  useEffect(() => {
    setTakeawaysDismissed(false);
  }, [task.id, task.status]);
  // Conversation-only stream (tools / work-log density toggles removed).
  const density: StreamDensity = "chat";
  // Chat-first: keep the files rail closed until the user opens it.
  // Restore per-conversation layout (pin / keep-closed / files panel).
  const [railOpen, setRailOpen] = useState(() =>
    layoutForConversation(loadLayoutStore(), conversationId).filesPanelOpen,
  );
  const [browserCapability, setBrowserCapability] = useState<BrowserCapability>(
    () => initialBrowserCapability(),
  );
  /** Chat column % when browser is open (browser fills the rest). */
  const [chatSplitPct, setChatSplitPct] = useState(DEFAULT_CHAT_SPLIT_PCT);
  const [splitDragging, setSplitDragging] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 1440),
  );
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [preview, setPreview] = useState<TextPreview | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mediaLightboxOpen, setMediaLightboxOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const prevStatus = useRef(task.status);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<TaskStreamHandle | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [approving, setApproving] = useState<ApprovalBusyState>({});
  const pendingApprovalId = approvalIdFromPendingEvent(props.pendingApproval);
  const pendingApprovalTarget =
    props.pendingApproval && pendingApprovalId
      ? { taskId: props.pendingApproval.taskId, approvalId: pendingApprovalId }
      : null;
  const pendingApprovalKey = pendingApprovalTarget
    ? `${pendingApprovalTarget.taskId}:${pendingApprovalTarget.approvalId}`
    : null;

  // I10: deep-link from Home needs-you → focus parked approval in stream.
  useEffect(() => {
    const approvalId = props.focusApprovalId;
    if (!approvalId) return;
    const taskId = props.pendingApproval?.taskId ?? task.id;
    const focused = streamRef.current?.focusApproval({
      taskId,
      approvalId,
    });
    if (focused || props.pendingApproval) {
      props.onFocusApprovalConsumed?.();
    }
  }, [
    props.focusApprovalId,
    props.pendingApproval,
    task.id,
    props.onFocusApprovalConsumed,
  ]);

  // Shared approve/reject runners so the top action bar and the inline turn card
  // drive the exact same flow + busy state — no "jump to find the buttons".
  const onApproveProp = props.onApprove;
  const onRejectProp = props.onReject;
  // Hold the busy lock through success so BOTH the action bar and the inline card
  // stay disabled until the approval actually clears (async `approval_resolved`
  // event) — this closes the window where a resolved-but-not-yet-cleared approval
  // could be submitted twice. Release the lock only on failure, and rethrow so the
  // caller can surface the error and let the user retry.
  const runApprove = useCallback(
    (target: ApprovalActionTarget) => {
      setApproving((state) => beginApprovalBusy(state, target, "approve"));
      return Promise.resolve(onApproveProp(target)).catch((err) => {
        setApproving((state) => endApprovalBusy(state, target));
        throw err;
      });
    },
    [onApproveProp],
  );
  const runReject = useCallback(
    (target: ApprovalActionTarget) => {
      setApproving((state) => beginApprovalBusy(state, target, "reject"));
      return Promise.resolve(onRejectProp(target)).catch((err) => {
        setApproving((state) => endApprovalBusy(state, target));
        throw err;
      });
    },
    [onRejectProp],
  );
  const [browserUi, setBrowserUi] = useState(initialBrowserUiState);
  const [browserStatus, setBrowserStatus] = useState<BrowserStatusDto | null>(
    null,
  );

  /** Chat-root id: one agent browser session per conversation thread. */
  const browserSessionId = useMemo(
    () => resolveChatRootId(task, props.threadTasks),
    [task, props.threadTasks],
  );

  // A conversation switch drops in-flight presentation state. Approval changes
  // within a conversation remain keyed so overlapping actions cannot clear peers.
  useEffect(() => {
    setApproving({});
  }, [props.task.id]);

  // Once nothing is awaiting a decision, release any held busy locks. The runners
  // deliberately hold the lock through success (to block double-submit until the
  // async `approval_resolved` event lands), so without this the `approving` map
  // would accumulate resolved-approval keys for the life of a long conversation.
  // Safe to clear here: with no pending approval nothing is actionable (the action
  // bar is unmounted and no turn is `waiting_approval`), so this can never drop a
  // live in-flight lock, and it stays keyed while the current approval is pending —
  // preserving the double-submit guard through the resolve window.
  useEffect(() => {
    if (pendingApprovalKey) return;
    setApproving((state) => (Object.keys(state).length ? {} : state));
  }, [pendingApprovalKey]);

  // Restore layout for the conversation; do not wipe pin/keep-closed prefs.
  // Always hide native views when switching chats so a prior pane cannot float.
  // Stale layout.browserOpen after a failed harvest must not reopen an empty
  // pane — require pin or a successful browser_open already in the stream.
  useEffect(() => {
    const layout = layoutForConversation(loadLayoutStore(), browserSessionId);
    const hadSuccessfulOpen = streamHasSuccessfulBrowserOpen(props.events);
    const open =
      layout.browserPinned ||
      (shouldRestoreBrowserOpen(layout) && hadSuccessfulOpen);
    setBrowserUi({
      open,
      pinned: layout.browserPinned,
      keepClosed: layout.browserKeepClosed,
    });
    setBrowserStatus(null);
    setRailOpen(layout.filesPanelOpen);
    setPreviewOpen(false);
    setSelectedPath(null);
    // Collapse every native view first; setVisible(false) hides all orphans.
    void browserSetVisible(browserSessionId, false);
    if (open) {
      void browserSetVisible(browserSessionId, true);
    }
    // Only re-run on chat switch. Live success open is handled by the activity effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: session boundary only
  }, [browserSessionId]);

  // Persist layout by conversation (pin / keep-closed / files panel).
  useEffect(() => {
    const store = setLayoutForConversation(loadLayoutStore(), browserSessionId, {
      browserOpen: browserUi.open,
      browserPinned: browserUi.pinned,
      browserKeepClosed: browserUi.keepClosed,
      filesPanelOpen: railOpen,
    });
    saveLayoutStore(store);
  }, [browserSessionId, browserUi.open, browserUi.pinned, browserUi.keepClosed, railOpen]);

  // Verified pre-run capability handshake via gateway (no secrets in renderer).
  useEffect(() => {
    let cancelled = false;
    setBrowserCapability((c) => reduceBrowserCapability(c, { type: "starting" }));
    void rpc<{
      status?: string;
      tools?: string[];
      reason?: string;
      ok?: boolean;
      provider?: string;
    }>("browser.capability", {})
      .then((res) => {
        if (cancelled) return;
        const tools = res?.tools ?? [];
        const ok =
          res?.ok === true ||
          res?.status === "ready" ||
          tools.length > 0;
        setBrowserCapability((c) =>
          reduceBrowserCapability(c, {
            type: "handshake",
            ok,
            tools,
            reason: ok
              ? "healthy"
              : (res?.reason as "host_missing") || "host_missing",
          }),
        );
        // Receipt helper stays reachable so browserProvider is product-visible.
        void browserProviderReceipt(
          reduceBrowserCapability(initialBrowserCapability(), {
            type: "handshake",
            ok,
            tools,
          }),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setBrowserCapability((c) =>
          reduceBrowserCapability(c, {
            type: "handshake",
            ok: false,
            reason: "host_missing",
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [browserSessionId]);

  // Auto-open only when the agent actually opened a page successfully (or a
  // live browser tool is in flight without a failed result). A historical
  // failed harvest must not reopen the empty pane on every chat visit.
  useEffect(() => {
    if (!streamHasSuccessfulBrowserOpen(props.events)) return;
    setBrowserUi((s) =>
      reduceBrowserUi(s, { type: "agent_browser_activity" }),
    );
    setBrowserCapability((c) =>
      c.status === "unavailable"
        ? reduceBrowserCapability(c, {
            type: "handshake",
            ok: true,
            tools: c.tools.length ? c.tools : ["browser_open"],
          })
        : c,
    );
  }, [props.events, browserSessionId]);

  useEffect(() => {
    void browserSetVisible(browserSessionId, browserUi.open);
  }, [browserUi.open, browserSessionId]);

  // Prefer chat | browser as the primary pair — collapse the files rail when
  // the agent browser opens so the conversation stays beside the page.
  useEffect(() => {
    if (browserUi.open) setRailOpen(false);
  }, [browserUi.open]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Drag the split handle to rebalance chat vs browser without leaving the page.
  useEffect(() => {
    if (!splitDragging) return;
    const onMove = (e: PointerEvent) => {
      const el = splitContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setChatSplitPct(
        chatSplitPctFromPointer(e.clientX, rect.left, rect.width),
      );
    };
    const onUp = () => {
      setSplitDragging(false);
      // Force a layout pass so the native browser view re-snaps to the surface.
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [splitDragging]);

  useEffect(() => {
    let cancelled = false;
    const applyStatus = (s: BrowserStatusDto | null) => {
      if (cancelled || !s || s.taskId !== browserSessionId) return;
      setBrowserStatus(s);
      if (statusShowsBrowserActivity(s)) {
        setBrowserUi((state) =>
          reduceBrowserUi(state, { type: "agent_browser_activity" }),
        );
      }
    };
    const unsubscribe = browserOnStatus(applyStatus);
    // Recover a navigation that completed just before this view subscribed.
    void browserGetStatus(browserSessionId).then(applyStatus).catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [browserSessionId]);

  const railVisible = showDeliverablesRail({
    browserOpen: browserUi.open,
    railOpen,
    viewportWidth,
  });

  // Note: we intentionally do NOT auto-open the files rail, HTML preview sheet,
  // or agent browser when artifacts appear. Deliverables stay listed; the user
  // opens them (or the browser) on demand so chat remains the default surface.

  const onBrowserBounds = useMemo(
    () =>
      (
        id: string,
        bounds: { x: number; y: number; width: number; height: number } | null,
      ) => {
        void browserSetBounds(id, bounds);
      },
    [],
  );

  const getViewport = () =>
    scrollRootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    ) ?? null;

  const scrollToEnd = (behavior: ScrollBehavior = "auto") => {
    // Prefer TaskStream handle so virtualized threads use scrollToIndex.
    if (streamRef.current) {
      streamRef.current.scrollToEnd(behavior);
      return;
    }
    const vp = getViewport();
    if (!vp) return;
    if (behavior === "smooth") {
      vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" });
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const v = getViewport();
          if (v) v.scrollTop = v.scrollHeight;
        });
      });
    }
  };

  // Track whether the reader is parked near the bottom of the conversation.
  useEffect(() => {
    const vp = getViewport();
    if (!vp) return;
    const onScroll = () => {
      setAtBottom(
        isNearBottom(vp.scrollHeight, vp.scrollTop, vp.clientHeight),
      );
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => vp.removeEventListener("scroll", onScroll);
  }, [density, task.id]);

  // Always land at the end of the thread when opening / switching tasks.
  useEffect(() => {
    setAtBottom(true);
    scrollToEnd("auto");
  }, [task.id]);

  // Fingerprint stream growth (count + last payload size) so token merges still follow.
  const streamFingerprint = useMemo(
    () => computeStreamFingerprint(props.events, task.status),
    [props.events, task.status],
  );

  // Soft follow: only stick to the bottom when the reader is already there.
  // Never yank the view when the user has scrolled up mid-run.
  useEffect(() => {
    if (!atBottom) return;
    scrollToEnd("auto");
  }, [streamFingerprint, atBottom, density]);

  function jumpToLatest() {
    setAtBottom(true);
    scrollToEnd("smooth");
  }

  // One-shot light sweep the moment a task lands on "done".
  // Also park the caret in the follow-up box so the next idea is one Enter away.
  useEffect(() => {
    if (shouldCelebrateDone(prevStatus.current, task.status)) {
      setCelebrate(true);
      const timer = setTimeout(() => setCelebrate(false), CELEBRATE_DONE_MS);
      requestAnimationFrame(() => {
        followInputRef.current?.focus();
      });
      prevStatus.current = task.status;
      return () => clearTimeout(timer);
    }
    prevStatus.current = task.status;
  }, [task.status]);

  // Project files for @-mention picker only (not deliverables).
  useEffect(() => {
    if (projectRoots.length === 0) {
      setProjectFiles([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      projectRoots.map((r) =>
        rpc<Array<{ name: string; path: string; isDir: boolean }>>(
          "workspace.listFiles",
          { root: r, max: 40 },
        ).catch(() => [] as Array<{ name: string; path: string; isDir: boolean }>),
      ),
    )
      .then((lists) => {
        if (cancelled) return;
        setProjectFiles(
          mergeProjectFileMentions(lists) as MentionCandidate[],
        );
      })
      .catch(() => {
        if (!cancelled) setProjectFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoots.join("|"), task.id]);

  // sizeBytes lives on artifact_created payloads (ASSET-2); Artifact rows may
  // not carry it after restart — merge from live events when present.
  const sizeBytesByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const ev of props.events) {
      if (ev.kind !== "artifact_created") continue;
      const p = ev.payload;
      if (typeof p.path === "string" && typeof p.sizeBytes === "number") {
        m.set(pathKey(p.path), p.sizeBytes);
      }
    }
    return m;
  }, [props.events]);

  const deliverables: Deliverable[] = useMemo(
    () =>
      buildDeliverablesFromArtifacts(
        arts.map((a) => ({
          id: a.id,
          title: a.title,
          path: a.path,
          sizeBytes: a.path
            ? sizeBytesByPath.get(pathKey(a.path))
            : undefined,
        })),
        t("workspace.deliverableLabel"),
      ) as Deliverable[],
    [arts, sizeBytesByPath, t],
  );

  const deliverableGroups = useMemo(
    () => groupDeliverables(deliverables),
    [deliverables],
  );

  const mentionRoots = useMemo(
    () => mentionRootsFromProjects(projectRoots),
    [projectRoots],
  );

  const mentionQuery = extractMentionQuery(followUp, followCursor);
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const attached = attachedMentionCandidates(followAttachments);
    const dels = deliverableMentionCandidates(deliverables);
    return filterMentionCandidates(
      [...attached, ...dels, ...projectFiles] as MentionCandidate[],
      mentionQuery.query,
      8,
      mentionRoots,
    );
  }, [mentionQuery, followAttachments, deliverables, projectFiles, mentionRoots]);

  const slashQuery = extractSlashQuery(followUp, followCursor);
  const slashMenuOpen = isSlashMenuVisible(
    slashQuery,
    slashDismissedKey,
    Boolean(mentionQuery),
  );
  const slashCandidates = useMemo(() => {
    if (!slashQuery || !slashMenuOpen) return [];
    return filterSlashCommands(slashQuery.token);
  }, [slashQuery, slashMenuOpen]);

  // CMD-1/3: recognition-driven effort (not menu selection).
  const armed = useMemo(() => armedSlashCommand(followUp), [followUp]);
  const mediaKind = mediaKindFromTokens(
    armed?.command.id,
    armed?.command.token,
  );
  const mediaStill = stillImagePathFromAttachments(followAttachments);
  const armedEffortRef = useRef<ArmedEffortState>({
    saved: null,
    applied: null,
  });
  useEffect(() => {
    if (!props.onEffort) return;
    const current = props.effort ?? "normal";
    const r = armedEffortTransition(
      armedEffortRef.current,
      current,
      armed?.command.effort ?? null,
    );
    armedEffortRef.current = r.state;
    if (r.set) props.onEffort(r.set);
    // Only re-run when the armed command identity changes (arm/disarm/switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [armed?.command.id]);

  const undoConversationTurn = async (turn: {
    id: string;
    taskId: string;
  }) => {
    try {
      const points = await taskRewindPoints(turn.taskId);
      if (!points?.length) {
        toast({
          description: t("workspace.undoUnavailable"),
          variant: "destructive",
        });
        return;
      }
      const point = mapTurnToRewindPoint(
        conversation.turns,
        points,
        turn.id,
      );
      if (!point) {
        toast({
          description: t("workspace.undoUnavailable"),
          variant: "destructive",
        });
        return;
      }
      const files = point.files ?? [];
      const ok = await ownedConfirm.ask({
        title: t("conversation.undoTurn"),
        description: t("conversation.rewindConversationHint"),
        items: files,
      });
      if (!ok) return;
      const result = await taskRewind(turn.taskId, point.id, turn.id);
      if (!result.ok) {
        toast({
          description: t("workspace.rewindFailed"),
          variant: "destructive",
        });
      } else {
        toast({ description: t("workspace.turnUndone") });
      }
    } catch (e) {
      toast({
        description:
          e instanceof Error ? e.message : t("workspace.undoFailed"),
        variant: "destructive",
      });
    }
  };

  const applySlashFollow = (cmd: SlashCommand) => {
    const slash = extractSlashQuery(followUp, followCursor);
    if (!slash) return;
    setSlashDismissedKey(null);
    if (cmd.kind === "fill") {
      // CMD-1: complete the token; template expands at send time.
      const r = applySlashCommand(followUp, slash, `/${cmd.token} `);
      setFollowUp(r.text);
      setFollowCursor(r.cursor);
      if (shouldPickFolderForSlash(cmd, props.root)) {
        props.onPickRoot?.();
      }
      requestAnimationFrame(() => {
        const el = followInputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(r.cursor, r.cursor);
        }
      });
      return;
    }
    const r = applySlashCommand(followUp, slash, "");
    setFollowUp(r.text);
    setFollowCursor(r.cursor);
    const side = slashSideAction(cmd);
    if (side === "pickFolder") props.onPickRoot?.();
    else if (side === "openSchedule") props.onOpenScheduled?.();
    else if (side === "openTools") props.onOpenTools?.();
    else if (side === "openMemory") props.onOpenMemory?.();
    else if (side === "exportPack") {
      void exportChatMarkdown(task.id)
        .then((r) => {
          const ok = exportChatSuccessIntent(r.path);
          if (ok.kind === "success") {
            toast({
              description: t("workspace.exportSaved", { path: ok.path }),
            });
          }
        })
        .catch((e) => {
          const err = exportChatErrorIntent(e, t("workspace.exportFailed"));
          toast({
            description: err.kind === "error" ? err.message : t("workspace.exportFailed"),
            variant: "destructive",
          });
        });
    } else if (side === "compact") {
      void taskCompact(task.id).then((result) => {
        if (!result.ok) {
          toast({
            description: t("workspace.summarizeUnavailable"),
            variant: "destructive",
          });
        }
      });
    } else if (side === "remember") {
      if (props.onRememberTakeaways) props.onRememberTakeaways(task.id);
    } else if (side === "rewind") {
      const last = [...conversation.turns].reverse().find((turn) => !turn.superseded);
      if (last) void undoConversationTurn(last);
      else {
        toast({
          description: t("workspace.undoUnavailable"),
          variant: "destructive",
        });
      }
    }
  };

  const deliverableNames = deliverables.map((d) => d.title);
  const summaryText = useMemo(
    () =>
      extractResultSummary(props.events, {
        status: task.status,
        deliverableNames,
      }),
    [props.events, task.status, deliverableNames.join("|")],
  );

  function openFile(path: string) {
    setSelectedPath(path);
    setPreviewOpen(true);
  }

  async function openHtmlInAgentBrowser(filePath: string) {
    try {
      const res = await rpc<{ ok?: boolean; output?: string }>(
        "browser.openHtml",
        { taskId: task.id, path: filePath },
      );
      if (res?.ok) {
        setBrowserUi((s) => reduceBrowserUi(s, { type: "user_open" }));
        toast({
          description: t("workspace.openedInBrowser"),
          variant: "default",
        });
      } else {
        toast({
          description: res?.output || t("workspace.openInBrowserFailed"),
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        description:
          e instanceof Error ? e.message : t("workspace.openInBrowserFailed"),
        variant: "destructive",
      });
    }
  }

  async function openUrlInAgentBrowser(url: string) {
    // The user's click should respond immediately. Navigation can take time on
    // a cold browser process or slow network, so reveal the pane first and let
    // its own loading/error state tell the truth while the host request settles.
    const wasOpen = browserUi.open;
    setBrowserUi((state) => reduceBrowserUi(state, { type: "user_open" }));
    try {
      const res = await rpc<{ ok?: boolean; output?: string }>(
        "browser.openUrl",
        { taskId: task.id, url },
      );
      if (res?.ok) return;
      setBrowserUi((state) =>
        reduceBrowserUi(state, { type: "user_open_failed", wasOpen }),
      );
      toast({
        description: res?.output || t("workspace.openInBrowserFailed"),
        variant: "destructive",
        action: {
          label: t("turn.retry"),
          onClick: () => {
            void openUrlInAgentBrowser(url);
          },
        },
      });
    } catch (error) {
      setBrowserUi((state) =>
        reduceBrowserUi(state, { type: "user_open_failed", wasOpen }),
      );
      toast({
        description:
          error instanceof Error
            ? error.message
            : t("workspace.openInBrowserFailed"),
        variant: "destructive",
        action: {
          label: t("turn.retry"),
          onClick: () => {
            void openUrlInAgentBrowser(url);
          },
        },
      });
    }
  }

  async function openInFileManager(target: string) {
    const res = await revealPath(target);
    const intent = toastForRevealResult(res, t("toast.openInFinderFailed"));
    if (intent.kind === "error") {
      toast({ description: intent.message, variant: "destructive" });
      return;
    }
    if (intent.kind === "info") {
      // Partial success (e.g. file gone, opened parent folder).
      toast({ description: intent.message, variant: "default" });
    }
  }

  // Load the preview for the open file (image via asset bridge, else text).
  useEffect(() => {
    if (!selectedPath || !previewOpen) return;
    let cancelled = false;
    setPreview(null);
    setPreviewImage(null);
    setPreviewLoading(true);

    const done = () => {
      if (!cancelled) setPreviewLoading(false);
    };

    if (isImagePath(selectedPath) || isVideoPath(selectedPath)) {
      void readAsset(selectedPath, { root })
        .then((a) => {
          if (!cancelled) setPreviewImage(assetDisplaySrc(a));
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            const detail =
              e instanceof Error ? e.message : t("workspace.couldNotLoadFile");
            setPreview(
              failedTextPreview({
                path: selectedPath,
                name: fileName(selectedPath),
                content: previewLoadErrorContent({
                  detail,
                  missingHint: t("workspace.fileMissingHint"),
                  genericHint: t("workspace.fileLoadErrorHint"),
                }),
              }),
            );
          }
        })
        .finally(done);
      return () => {
        cancelled = true;
      };
    }

    void rpc<TextPreview>("workspace.readFile", {
      path: selectedPath,
      maxChars: 60_000,
    })
      .then((r) => {
        if (!cancelled) setPreview(r);
      })
      .catch(() => {
        if (!cancelled)
          setPreview(
            failedTextPreview({
              path: selectedPath,
              name: fileName(selectedPath),
              content: t("workspace.couldNotLoadFile"),
            }),
          );
      })
      .finally(done);
    return () => {
      cancelled = true;
    };
  }, [selectedPath, previewOpen, root, t]);

  return (
    <div
      ref={splitContainerRef}
      className={cn(
        "flex min-h-0 flex-1",
        browserUi.open && "browser-split-open",
      )}
      data-browser-open={browserUi.open ? "true" : "false"}
    >
      {/* Conversation column — always left; shares row with browser when open */}
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-col",
          "transition-[flex-basis,width,max-width,padding] duration-200 ease-premium",
          browserChatColumnFlexClass(browserUi.open),
          splitDragging && "pointer-events-none select-none !transition-none",
        )}
        style={browserChatColumnStyle({
          browserOpen: browserUi.open,
          chatSplitPct,
          railVisible,
        })}
      >
        {/* Slim task header: back + title · status | density · tools · overflow */}
        <div
          className={cn(
            "border-b border-border/60 px-3 py-2.5 sm:px-4 sm:py-3",
            browserUi.open && "px-3 py-2",
            celebrate && "sweep-once",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2.5">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-0.5 h-8 shrink-0 gap-0.5 px-2 text-muted-foreground hover:text-foreground [&_svg]:pointer-events-auto"
                    onClick={props.onBackToList}
                    aria-label={t("nav.chats")}
                  >
                    <ChevronLeftIcon size={16} strokeWidth={1.75} />
                    <span className="hidden text-sm sm:inline">
                      {t("nav.chats")}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="sm:hidden">
                  {t("nav.chats")}
                </TooltipContent>
              </Tooltip>
              <div className="min-w-0 flex-1 pt-0.5">
                <h1
                  className="truncate text-lg font-semibold leading-tight tracking-tight sm:text-lg"
                  title={`${summaryText} · ${task.model} · ${effortLabel(task.effort)}`}
                >
                  {props.chatTitle}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusPill
                    status={task.status}
                    emphasis
                    delivery={{
                      taskStatus: task.status,
                      accepted: !isOptimistic,
                      saving: isOptimistic,
                      // Optimistic past acceptance deadline → Checking delivery…
                      acceptanceTimedOut:
                        isOptimistic &&
                        Date.now() - Date.parse(task.createdAt) > 15_000,
                      terminal: isTerminalTaskStatus(task.status),
                      needsAttention:
                        task.status === "waiting_approval" ||
                        task.status === "waiting_user" ||
                        task.status === "blocked",
                    }}
                  />
                  {headerActivityCaption ? (
                    <span
                      className="max-w-[240px] truncate text-2xs text-muted-foreground"
                      title={headerActivityCaption}
                      data-header-activity
                    >
                      {headerActivityCaption}
                    </span>
                  ) : (
                    <span className="text-2xs text-muted-foreground">
                      {relativeTime(task.updatedAt)}
                    </span>
                  )}
                </div>
                <SessionStatusHeader
                  snapshot={acpSessionStatus}
                  source={liveAcpStatus ? "acp" : "headless"}
                />
                {goalProgress ? (
                  <p
                    key={goalProgress.line}
                    className="chat-fade-in mt-0.5 max-w-xl truncate text-2xs text-muted-foreground"
                    title={goalProgress.line}
                    data-testid="goal-progress-line"
                    data-goal-source={goalProgress.source}
                  >
                    {goalProgress.line}
                  </p>
                ) : null}
                {watchUntil ? (
                  <WatchUntilPanel
                    view={watchUntil}
                    onStop={() => {
                      const prompt = watchUntilStopPrompt(watchUntil);
                      if (isLive) {
                        void taskInterject(task.id, prompt);
                        return;
                      }
                      void Promise.resolve(props.onFollowUp?.(prompt));
                    }}
                  />
                ) : null}
                {workflowRun ? (
                  <WorkflowRunPanel
                    view={workflowRun}
                    onControl={(action) => {
                      const prompt = workflowControlPrompt(
                        action,
                        workflowRun.handle,
                      );
                      if (isLive) {
                        void taskInterject(task.id, prompt);
                        return;
                      }
                      void Promise.resolve(props.onFollowUp?.(prompt));
                    }}
                  />
                ) : null}
                {task.status === "waiting_approval" ||
                task.status === "waiting_user" ? (
                  <p
                    className="mt-0.5 max-w-xl truncate text-2xs font-medium text-warning"
                    data-testid="needs-you-action"
                    data-required-action="true"
                  >
                    {task.status === "waiting_user"
                      ? t("conversation.waitingForYou")
                      : conversation.turns.find((tr) => tr.id === task.id)
                            ?.approval?.summary
                        ? conversation.turns.find((tr) => tr.id === task.id)!
                            .approval!.summary
                        : t("conversation.needsYouAction")}
                  </p>
                ) : null}
                {helpersHud && helpersHud.items.length > 0 ? (
                  <p
                    className="mt-0.5 text-2xs text-muted-foreground"
                    data-testid="helpers-hud-summary"
                  >
                    {helpersHud.activeCount > 0
                      ? t("conversation.workerCountMany", {
                          count: helpersHud.activeCount,
                        })
                      : t("conversation.workerCountOne", { count: 1 })}
                    {": "}
                    {helpersHud.items
                      .slice(0, 3)
                      .map((i) => i.name)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <BrowserGlobe
                active={Boolean(
                  browserStatus?.active ||
                    browserStatus?.loading ||
                    props.events.some(
                      (e) =>
                        e.kind === "tool_request" &&
                        isBrowserToolPayload(e.payload.tool),
                    ),
                )}
                open={browserUi.open}
                capabilityState={browserGlobeState(browserCapability, {
                  activityOpen:
                    browserUi.open ||
                    Boolean(browserStatus?.active || browserStatus?.loading),
                })}
                pinned={browserUi.pinned}
                onPin={() =>
                  setBrowserUi((s) =>
                    reduceBrowserUi(s, {
                      type: "user_pin",
                      pinned: !s.pinned,
                    }),
                  )
                }
                onToggle={() => {
                  // When desk-browser is unavailable, require explicit external choice.
                  if (
                    browserCapability.status === "unavailable" &&
                    !mayUseExternalBrowser(browserCapability)
                  ) {
                    void ownedConfirm
                      .ask({
                        title: t("runtimeInstall.continue"),
                        description: t("workspace.allowExternalBrowser"),
                      })
                      .then((allow) => {
                        if (allow) {
                          setBrowserCapability((c) =>
                            reduceBrowserCapability(c, {
                              type: "allow_external",
                              allowed: true,
                            }),
                          );
                          void rpc("browser.allowExternal", {
                            allowed: true,
                          }).catch(() => {});
                        }
                      });
                    return;
                  }
                  setBrowserUi((s) =>
                    reduceBrowserUi(s, { type: "user_toggle" }),
                  );
                }}
              />
              <IconTooltipButton
                label={
                  railOpen
                    ? t("workspace.hideSidePanel")
                    : t("workspace.showSidePanel")
                }
                variant="ghost"
                onClick={() => setRailOpen((v) => !v)}
                className={cn(
                  "h-8 w-8",
                  railOpen && "bg-muted text-foreground",
                )}
                aria-pressed={railOpen}
              >
                {railOpen ? (
                  <PanelRightClose size={14} />
                ) : (
                  <PanelRightOpen size={14} />
                )}
              </IconTooltipButton>
              {isLive && (
                <IconTooltipButton
                  label={t("desktop.pause")}
                  variant="outline"
                  onClick={props.onPauseAll}
                  className="h-8 w-8"
                >
                  <PauseIcon size={14} />
                </IconTooltipButton>
              )}
              <TaskOverflowMenu
                taskId={task.id}
                modelLabel={task.model}
                effortLabel={effortLabel(task.effort)}
                onExport={() => {
                  void exportChatMarkdown(task.id)
                    .then(async (r) => {
                      const ok = exportChatSuccessIntent(r.path);
                      if (ok.kind === "success") {
                        toast({
                          description: t("workspace.exportSaved", {
                            path: ok.path,
                          }),
                        });
                      }
                      await revealPath(r.path);
                    })
                    .catch((e: unknown) => {
                      const err = exportChatErrorIntent(
                        e,
                        t("workspace.exportFailed"),
                      );
                      if (err.kind === "error") {
                        toast({
                          description: err.message,
                          variant: "destructive",
                        });
                      }
                    });
                }}
                onViewAudit={() => setAuditOpen(true)}
                onRemember={
                  props.onRememberTakeaways
                    ? () => props.onRememberTakeaways?.(task.id)
                    : undefined
                }
                onImagine={
                  props.onImagineFromTask
                    ? () =>
                        props.onImagineFromTask?.(
                          task.id,
                          imagineGoalFromTask(task.goal),
                        )
                    : undefined
                }
                onHelp={() => {
                  window.open(
                    "https://docs.x.ai/build/overview",
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
                onOpenFolder={
                  root ? () => void openInFileManager(root) : undefined
                }
                showResume={!isTerminal && !isLive}
                onResume={props.onResumeAll}
                showCancel={isLive}
                onCancel={props.onCancel}
              />
            </div>
          </div>
        </div>

        {pendingApprovalTarget && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/20 bg-warning/[0.05] px-6 py-2"
            role="status"
            aria-label={t("workspace.approvalNeeded")}
          >
            <ShieldAlert
              className="h-4 w-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-warning">
              {t("workspace.approvalNeeded")}
            </span>
            <button
              type="button"
              className="text-xs font-normal text-warning/80 underline-offset-2 transition-colors hover:text-warning hover:underline"
              data-approval-jump
              onClick={() => {
                streamRef.current?.focusApproval(pendingApprovalTarget);
              }}
            >
              {t("workspace.jumpToApproval")}
            </button>
          </div>
        )}

        {/* The conversation is the hero — sits beside the browser when open */}
        <div className={cn("pt-2", browserUi.open ? "px-3" : "px-6")}>
          <DesktopControlHud taskId={task.id} onPauseAll={props.onPauseAll} />
        </div>
        <ScrollArea ref={scrollRootRef} className="flex-1">
          <div
            className={cn(
              "py-4 sm:py-6",
              browserUi.open ? "px-3 sm:px-4" : "px-6",
            )}
            aria-busy={
              !isOptimistic && task.status === "running" ? true : undefined
            }
            data-delivery-busy={
              !isOptimistic && task.status === "running" ? "running" : undefined
            }
          >
            <EventHistoryBanner
              status={{
                error: props.eventsError,
                staleSince: props.eventsStaleSince,
                truncated: props.eventsTruncated,
                loading: props.eventsLoading,
              }}
              onRetry={props.onRetryEvents}
            />
            <TaskStream
              ref={streamRef}
              events={props.events}
              eventsLoading={props.eventsLoading === true}
              taskStatus={task.status}
              deliveryAccepted={!isOptimistic}
              density={density}
              isLive={isLive}
              baseDir={root ?? null}
              onOpenFile={openFile}
              onOpenDeliverables={() => setRailOpen(true)}
              onOpenUrl={openUrlInAgentBrowser}
              elapsedStartIso={task.createdAt}
              followUpBusy={Boolean(props.followUpBusy)}
              onAnswerQuestion={
                props.onFollowUp
                  ? (label) => {
                      void Promise.resolve(props.onFollowUp?.(label));
                    }
                  : undefined
              }
              conversation={conversation}
              editableTaskId={editableTaskId}
              onEditConversationTurn={beginRevisionEdit}
              onSaveConversationTurnEdit={
                props.onFollowUp ? saveConversationTurnEdit : undefined
              }
              unreadBoundarySeq={openUnreadBoundarySeq}
              firstUnreadTurnId={firstUnreadTurnId}
              regeneratingTaskId={regeneratingTaskId}
              onRetryConversationTurn={
                props.onFollowUp
                  ? (turn) => {
                      // CHAT-1: re-run the turn's compact user message as a follow-up.
                      void Promise.resolve(
                        props.onFollowUp?.(
                          turn.userMessage,
                          turn.attachments.length
                            ? turn.attachments
                            : undefined,
                        ),
                      );
                    }
                  : undefined
              }
              onApprove={runApprove}
              onReject={runReject}
              approvalBusy={approving}
              onRecoveryAction={(action) => {
                if (action === "openBilling") void openBilling();
                if (action === "openUsage") props.onOpenSettings?.();
                if (action === "signIn") props.onSignIn?.();
                if (action === "retry") {
                  const g = buildSmartRetryGoal({
                    originalGoal: task.goal,
                    failureMessage: extractFailureMessage({
                      errorMessage: (task as { errorMessage?: string })
                        .errorMessage,
                      lastEventMessage: summaryText,
                      status: task.status,
                    }),
                    partialAnswer: summaryText,
                  });
                  void Promise.resolve(props.onFollowUp?.(g));
                }
              }}
              onUndoTurn={undoConversationTurn}
              onRememberAnswer={
                props.onRememberText
                  ? (turn, text) =>
                      props.onRememberText?.({
                        taskId: turn.taskId,
                        text,
                        goal: turn.userMessage,
                      })
                  : undefined
              }
            />
          </div>
        </ScrollArea>

        {!atBottom && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="surface-raised absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-foreground/90 transition-all duration-200 ease-premium animate-fade-in hover:text-foreground"
          >
            <ArrowDown className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
            {t("workspace.jumpToLatest")}
          </button>
        )}

        {props.onFollowUp && (
          <ConversationComposer browserOpen={browserUi.open}>
            {/* Task 14: review strip sits with post-run actions, not a dead gap above the stream. */}
            {reviewChanges && !reviewDismissed ? (
              <div
                className="mx-auto mb-2 max-w-[46rem]"
                data-testid="review-changes-near-result"
              >
                <ReviewChangesStrip
                  view={reviewChanges}
                  needsUserAttention={false}
                  onDismiss={() => setReviewDismissed(true)}
                  onKeepFile={(path) => {
                    const next = applyReviewFileAction(
                      reviewChanges,
                      path,
                      "keep",
                    );
                    setReviewOverride(next);
                    toast({
                      description: t("reviewChanges.kept", { path }),
                    });
                  }}
                  onOpenFile={(path) => {
                    void openInFileManager(path).catch(() => {
                      /* best-effort */
                    });
                  }}
                />
              </div>
            ) : null}
            {/* Default post-run actions - no menu diving required */}
            {/* What next? chips only - takeaways lives here (and overflow menu). */}
            {isTerminal &&
              !hasPendingQuestion &&
              (() => {
                const actions = filterFollowUpActions(
                  pickFollowUpActions({
                    status: task.status,
                    hasArtifacts: arts.length > 0,
                  }),
                  {
                    takeawaysDismissed,
                    hasRememberTakeaways: Boolean(props.onRememberTakeaways),
                  },
                );
                if (actions.length === 0) return null;
                const runAction = (a: FollowUpAction) => {
                  const effect = resolveNextActionEffect(
                    a,
                    firstArtifactPath(arts),
                  );
                  switch (effect.type) {
                    case "followUp": {
                      if (
                        a.id === "retry" &&
                        shouldOfferSmartRetry(task.status)
                      ) {
                        const g = buildSmartRetryGoal({
                          originalGoal: task.goal,
                          failureMessage: extractFailureMessage({
                            errorMessage: (task as { errorMessage?: string })
                              .errorMessage,
                            lastEventMessage: summaryText,
                            status: task.status,
                          }),
                          partialAnswer: summaryText,
                        });
                        void Promise.resolve(props.onFollowUp?.(g));
                        return;
                      }
                      const g = t(effect.goalKey);
                      void Promise.resolve(props.onFollowUp?.(g));
                      return;
                    }
                    case "takeaways":
                      props.onRememberTakeaways?.(task.id);
                      setTakeawaysDismissed(true);
                      return;
                    case "imagine":
                      props.onImagineFromTask?.(
                        task.id,
                        imagineGoalFromTask(task.goal),
                      );
                      return;
                    case "openFiles":
                      setRailOpen(true);
                      if (effect.firstPath) void openFile(effect.firstPath);
                      return;
                    case "schedule":
                      props.onScheduleFromTask?.(task.goal);
                      return;
                    case "saveRecipe": {
                      const { store, recipe } = saveRecipe(loadRecipeStore(), {
                        goal: task.goal,
                        title: props.chatTitle ?? task.title,
                        workspaceRoot:
                          task.policySnapshot?.workspaceRoots?.[0] ?? null,
                        sourceTaskId: task.id,
                      });
                      if (!recipe) {
                        toast({
                          description: t("workspace.recipeSaveFailed"),
                          variant: "destructive",
                        });
                        return;
                      }
                      saveRecipeStore(store);
                      toast({
                        description: t("workspace.recipeSaved", {
                          title: recipe.title,
                        }),
                      });
                      return;
                    }
                    case "copyAnswer": {
                      const msgs = props.events.map((e) => ({
                        role: String(
                          (e as { role?: string }).role ??
                            (e as { kind?: string }).kind ??
                            "assistant",
                        ),
                        text:
                          (e as { text?: string }).text ??
                          (e as { message?: string }).message ??
                          String(
                            (e as { payload?: { text?: string } }).payload
                              ?.text ?? "",
                          ),
                      }));
                      const prepared = prepareCopyLastResponse(msgs);
                      if (!prepared.ok) {
                        toast({
                          description: t("workspace.answerCopyEmpty"),
                        });
                        return;
                      }
                      void navigator.clipboard
                        .writeText(prepared.markdown)
                        .then(() =>
                          toast({
                            description: t("workspace.answerCopied"),
                          }),
                        )
                        .catch(() =>
                          toast({
                            description: t("workspace.answerCopyEmpty"),
                            variant: "destructive",
                          }),
                        );
                      return;
                    }
                    case "exportPack": {
                      const plan = planDeliverablePack({
                        chatTitle: props.chatTitle ?? task.title ?? task.goal,
                        taskId: task.id,
                        messages: props.events.map((e) => ({
                          role: String(
                            (e as { kind?: string }).kind ?? "assistant",
                          ),
                          text:
                            (e as { text?: string }).text ??
                            String(
                              (e as { payload?: { text?: string } }).payload
                                ?.text ?? "",
                            ),
                        })),
                        artifacts: arts.map((a) => ({
                          id: a.id,
                          title: a.title,
                          path: a.path,
                        })),
                      });
                      void exportChatMarkdown(task.id)
                        .then((r) => {
                          toast({
                            description: t("workspace.exportPackReady", {
                              summary: `${plan.summary} · ${r.path}`,
                            }),
                          });
                        })
                        .catch((e) => {
                          const err = exportChatErrorIntent(
                            e,
                            t("workspace.exportFailed"),
                          );
                          toast({
                            description:
                              err.kind === "error"
                                ? err.message
                                : t("workspace.exportFailed"),
                            variant: "destructive",
                          });
                        });
                      return;
                    }
                    default:
                      return;
                  }
                };
                return (
                  <div className="mx-auto mb-2 max-w-[46rem]">
                    <div className="mb-1.5 px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("workspace.nextActionsTitle")}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          disabled={Boolean(props.followUpBusy) || isOptimistic}
                          onClick={() => runAction(a)}
                          className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:border-primary/35 hover:bg-primary/10 hover:text-foreground disabled:opacity-50"
                        >
                          {t(a.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

            <ConversationOutbox
              items={messageQueue}
              busy={Boolean(props.followUpBusy) || isOptimistic}
              interjectingIds={interjectingIds}
              sendNowSupported={sendNowSupported}
              onEdit={editQueued}
              onEditAndSendNow={editAndSendQueuedNow}
              onRetry={retryQueued}
              onSendNow={sendQueuedNow}
              onRemove={removeQueued}
              onPickFiles={pickFiles}
            />
            <ConversationStatus
              engineReady={props.engineReady !== false}
              hasDraft={followUp.trim().length > 0}
              hasSavedLocalQueue={messageQueue.length > 0}
              enqueueError={composerEnqueueError}
            />
            {props.onEffort ? (
              <p
                className="mx-auto mb-1 max-w-[46rem] px-1 text-2xs text-muted-foreground"
                data-testid="next-reply-will-use"
              >
                {t(
                  "workspace.nextReplyWillUse",
                  nextReplyWillUseParams(
                    projectNextReplyPreview({
                      model: props.model ?? task.model,
                      effort: effortLabel(props.effort ?? task.effort),
                      approvalMode: props.approvalMode,
                      planFirst: props.planFirst,
                      rolePackName: props.rolePacks?.find(
                        (p) => p.id === props.rolePackId,
                      )?.name,
                    }),
                  ),
                )}
              </p>
            ) : null}
            <form
              data-testid="follow-up-composer-drop"
              className={cn(
                "vt-compose glow-ring relative mx-auto rounded-2xl bg-white/[0.03] px-2 py-1.5",
                browserUi.open ? "max-w-none" : "max-w-[46rem]",
                followDragOver && "ring-2 ring-primary/40",
              )}
              onSubmit={(e) => {
                e.preventDefault();
                if (editingRevision) {
                  const revision = revisionSubmitIntent(editingRevision, {
                    conversationId,
                    editableTaskId: revisionEligibilityTaskId,
                  });
                  if (!revision.allowed) {
                    const restored = cancelRevisionSession(editingRevision);
                    setFollowUp(restored.text);
                    setFollowAttachments(restored.attachments);
                    setEditingRevision(null);
                    toast({
                      description: t("conversation.editInvalidated"),
                    });
                    return;
                  }
                  const revisionDecision = resolveFollowUpSubmit({
                    goal: followUp,
                    busy: Boolean(props.followUpBusy),
                    optimistic: isOptimistic,
                    // A revision is never queueable. Its source was revalidated
                    // as the latest terminal task immediately above.
                    agentBusy: false,
                  });
                  if (revisionDecision.action === "noop") return;
                  const atts = toTaskAttachments(followAttachments);
                  void Promise.resolve(
                    props.onFollowUp?.(
                      revisionDecision.goal,
                      atts,
                      revision.clientMutationId,
                      revision.revisionOfTaskId,
                    ),
                  ).then((ok) => {
                    // Ambiguous transport failure keeps the same edit session
                    // and therefore the same idempotency key for a safe retry.
                    if (ok === false) return;
                    setFollowUp("");
                    setFollowAttachments([]);
                    setEditingRevision(null);
                    clearComposerDraft();
                  });
                  return;
                }
                const decision = resolveFollowUpSubmit({
                  goal: followUp,
                  busy: Boolean(props.followUpBusy),
                  optimistic: isOptimistic,
                  agentBusy,
                });
                if (decision.action === "noop") return;
                const g = decision.goal;
                const hasAudio = followAttachments.some(
                  (a) => a.kind === "audio",
                );
                if (hasAudio) {
                  setVoiceSending(true);
                  setTimeout(() => setVoiceSending(false), 600);
                }
                const atts = toTaskAttachments(followAttachments);
                const queuedGoal = weaveFollowUpComposerGoal({
                  goalText: g,
                  mediaStudio: mediaKind
                    ? {
                        ...mediaStudio,
                        kind: mediaKind,
                        stillImagePath: mediaStill,
                      }
                    : null,
                  attachments: atts,
                });
                // All follow-ups go through the gateway outbox (including idle
                // path). Gateway may drain immediately; never clear composer
                // until durable enqueue acceptance.
                const retainedDraft = queuedGoal;
                void enqueueAsync(queuedGoal, attachmentPathsForQueue(atts)).then(
                  (outcome) => {
                    if (outcome.outcome === "accepted") {
                      setComposerEnqueueError(null);
                      setFollowUp("");
                      setFollowAttachments([]);
                      clearComposerDraft();
                      toast({ description: t("workspace.messageQueued") });
                      return;
                    }
                    // Task 13: never clear draft; announce once adjacent; refocus.
                    const feedback = planEnqueueRejectionFeedback({
                      outcome: outcome.outcome,
                      reason:
                        "message" in outcome && typeof outcome.message === "string"
                          ? outcome.message
                          : undefined,
                      previousText: retainedDraft,
                    });
                    if (!feedback.clearDraft) {
                      setFollowUp(feedback.retainedText);
                    }
                    setComposerEnqueueError(t(feedback.messageKey));
                    if (feedback.refocusComposer) {
                      requestAnimationFrame(() => {
                        followInputRef.current?.focus();
                      });
                    }
                  },
                );
                void decision;
                void enqueueQueued;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setFollowDragOver(true);
              }}
              onDragLeave={() => setFollowDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setFollowDragOver(false);
                const files = Array.from(e.dataTransfer.files ?? []);
                const paths = filePathsFromDropFiles(
                  files as Array<{ path?: string }>,
                );
                if (paths.length) applyFollowAttachments(paths);
              }}
            >
              {editingRevision ? (
                <div
                  className="mb-1 flex items-center justify-between gap-3 rounded-xl bg-muted/55 px-3 py-2 text-xs text-foreground"
                  data-editing-message
                  role="status"
                >
                  <span>
                    <span className="block font-medium">
                      {t("conversation.editingMessage")}
                    </span>
                    <span className="block text-muted-foreground">
                      {t("conversation.editExplanation")}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      data-cancel-edit
                      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                      onClick={cancelRevisionEdit}
                    >
                      {t("turn.cancelEdit")}
                      <kbd className="rounded border border-border/60 px-1 font-mono text-2xs opacity-70">
                        {t("turn.kbdEsc")}
                      </kbd>
                    </button>
                    <button
                      type="submit"
                      data-save-edit
                      className="inline-flex items-center gap-1 rounded-md bg-primary/90 px-2 py-1 font-medium text-primary-foreground transition-colors hover:bg-primary disabled:opacity-50"
                      disabled={isFollowUpSendDisabled({
                        goal: followUp,
                        busy: Boolean(props.followUpBusy),
                        optimistic: isOptimistic,
                      })}
                    >
                      {t("turn.saveEdit")}
                      <kbd className="rounded border border-primary-foreground/25 px-1 font-mono text-2xs opacity-80">
                        {t("turn.kbdEnter")}
                      </kbd>
                    </button>
                  </div>
                </div>
              ) : null}
              {followDragOver && (
                <p className="px-2 pb-1 text-center text-2xs text-muted-foreground">
                  {t("composer.dropHint")}
                </p>
              )}
              <ComposerAttachments
                items={followAttachments}
                onRemove={(id) =>
                  setFollowAttachments(removeAttachment(followAttachments, id))
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
                  onSelect={(item) => {
                    if (!mentionQuery) return;
                    const r = insertMentionToken(
                      followUp,
                      followCursor,
                      mentionQuery.start,
                      item.path,
                      mentionRoots,
                    );
                    setFollowUp(r.text);
                    setFollowCursor(r.cursor);
                    applyFollowAttachments([item.path]);
                    requestAnimationFrame(() => {
                      const el = followInputRef.current;
                      if (el) {
                        el.focus();
                        el.setSelectionRange(r.cursor, r.cursor);
                      }
                    });
                  }}
                  anchorRef={followInputRef}
                  caretIndex={followCursor}
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
                  onSelect={applySlashFollow}
                  args={slashQuery?.args}
                  emptyHint={t("slash.noMatch")}
                />
              )}
              {armed ? (
                <ArmedCommandChip
                  label={t(armed.command.labelKey)}
                  effect={t(`slash.armedEffect.${armed.command.id}`)}
                  escalates={armed.command.effort != null}
                  clearLabel={t("slash.armedClear")}
                  expandsHint={t("slash.expandsOnSend")}
                  onClear={() => {
                    const next = stripArmedSlashPrefix(
                      followUp,
                      armed.command.token,
                    );
                    setFollowUp(next);
                    setFollowCursor(next.length);
                  }}
                />
              ) : null}
              <div className="flex items-end gap-2">
                <DictationButton
                  state={dictation.state}
                  level={dictation.level}
                  keepAudio={dictation.keepAudio}
                  keepAudioLabel={t("composer.keepAudio")}
                  onToggleKeepAudio={() =>
                    dictation.setKeepAudio(!dictation.keepAudio)
                  }
                  sending={voiceSending}
                  onClick={() => void dictation.toggle(followUp)}
                  title={
                    dictation.state === "listening"
                      ? t("dictation.stop")
                      : t("dictation.start")
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0 rounded-full"
                  title={t("composer.attach")}
                  onClick={() =>
                    void pickFiles().then((paths) => {
                      if (paths.length) applyFollowAttachments(paths);
                    })
                  }
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </Button>
                {props.onEffort ? (
                  <ComposerRunOptions
                    compact
                    model={props.model ?? task.model}
                    models={
                      props.models?.length
                        ? props.models
                        : [props.model ?? task.model]
                    }
                    onModel={props.onModel ?? (() => {})}
                    effort={props.effort ?? task.effort}
                    onEffort={props.onEffort}
                    approvalMode={
                      props.approvalMode ??
                      task.policySnapshot.approvalMode
                    }
                    onApprovalMode={props.onApprovalMode ?? (() => {})}
                    planFirst={props.planFirst}
                    onPlanFirst={props.onPlanFirst}
                  />
                ) : null}
                {props.rolePacks && props.rolePacks.length > 0 && props.onRolePack ? (
                  <RolePackPicker
                    packs={props.rolePacks}
                    value={props.rolePackId ?? null}
                    onChange={props.onRolePack}
                    variant="toolbar"
                  />
                ) : null}
                <Textarea
                  ref={followInputRef}
                  rows={1}
                  value={followUp}
                  onChange={(e) => {
                    setFollowUp(e.target.value);
                    setFollowCursor(
                      e.target.selectionStart ?? e.target.value.length,
                    );
                    setSlashActive(0);
                  }}
                  onSelect={(e) =>
                    setFollowCursor(
                      (e.target as HTMLTextAreaElement).selectionStart ?? 0,
                    )
                  }
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const it of Array.from(items)) {
                      if (!it.type.startsWith("image/")) continue;
                      e.preventDefault();
                      const blob = it.getAsFile();
                      if (!blob) continue;
                      void (async () => {
                        try {
                          const b64 = await blobToBase64(blob);
                          const ext = imageExtFromMime(it.type);
                          const p = await writeTempAttachment(
                            `paste-${Date.now()}.${ext}`,
                            b64,
                          );
                          if (p) applyFollowAttachments([p]);
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
                      })();
                      return;
                    }
                  }}
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
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const item =
                          mentionCandidates[
                            Math.min(
                              mentionActive,
                              mentionCandidates.length - 1,
                            )
                          ]!;
                        const r = insertMentionToken(
                          followUp,
                          followCursor,
                          mentionQuery.start,
                          item.path,
                          mentionRoots,
                        );
                        setFollowUp(r.text);
                        setFollowCursor(r.cursor);
                        applyFollowAttachments([item.path]);
                        requestAnimationFrame(() => {
                          const el = followInputRef.current;
                          if (el) {
                            el.focus();
                            el.setSelectionRange(r.cursor, r.cursor);
                          }
                        });
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        // Dismiss @query without sending the form.
                        const next =
                          followUp.slice(0, mentionQuery.start) +
                          followUp.slice(followCursor);
                        setFollowUp(next);
                        setFollowCursor(mentionQuery.start);
                        return;
                      }
                    }
                    // SC-3/4/5: slash menu keyboard (same contract as home composer).
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
                          applySlashFollow(
                            slashCandidates[
                              Math.min(slashActive, slashCandidates.length - 1)
                            ]!,
                          );
                          return;
                        }
                        if (e.key === "Tab") {
                          e.preventDefault();
                          applySlashFollow(
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
                    // CHAT-6: Escape cancels an open composer revision edit.
                    if (e.key === "Escape" && editingRevision) {
                      e.preventDefault();
                      cancelRevisionEdit();
                      return;
                    }
                    // CH-3: Escape stops the run when not dismissing mentions/slash.
                    if (e.key === "Escape" && isLive) {
                      e.preventDefault();
                      props.onCancel();
                      return;
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
                      if (!followUp.trim()) {
                        const queued = messageQueue.find(
                          (item) =>
                            item.status === "pending" ||
                            item.status === "failed",
                        );
                        if (queued) {
                          sendQueuedNow(queued);
                          return;
                        }
                      }
                      // Submit the form (Enter send / Shift+Enter newline).
                      (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                    }
                    // Shift+Enter: default newline (do not preventDefault).
                  }}
                  placeholder={t(frozenPlaceholder.displayKey)}
                  aria-label={t(frozenPlaceholder.displayKey)}
                  onFocus={() => setFollowFocused(true)}
                  onBlur={() => setFollowFocused(false)}
                  className="max-h-[176px] min-h-9 flex-1 resize-none border-0 bg-transparent py-2 shadow-none focus-visible:border-0 focus-visible:ring-0"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    {followUpPrimaryAction({ isLive, goal: followUp }) ===
                    "stop" ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="h-9 w-9 shrink-0"
                        aria-label={t("nav.stopTask")}
                        onClick={() => props.onCancel()}
                      >
                        <Square className="h-3.5 w-3.5" strokeWidth={2} />
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        size="icon"
                        className="h-9 w-9 shrink-0 [&_svg]:pointer-events-auto"
                        disabled={isFollowUpSendDisabled({
                          goal: followUp,
                          busy: Boolean(props.followUpBusy),
                          optimistic: isOptimistic,
                        })}
                        aria-label={t("workspace.send")}
                      >
                        <SendIcon size={16} strokeWidth={2} />
                      </Button>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {followUpPrimaryAction({ isLive, goal: followUp }) ===
                    "stop"
                      ? t("nav.stopTask")
                      : t("workspace.send")}
                  </TooltipContent>
                </Tooltip>
              </div>
              {mediaKind ? (
                <MediaStudioControls
                  kind={mediaKind}
                  value={{ ...mediaStudio, kind: mediaKind }}
                  onChange={setMediaStudio}
                  stillImageName={
                    mediaStill
                      ? mediaStill.split(/[/\\]/).pop() ?? mediaStill
                      : null
                  }
                />
              ) : null}
            </form>
            {dictation.state === "listening" && (
              <p className="mx-auto mt-1 max-w-[46rem] text-2xs text-muted-foreground">
                {t("dictation.listening", {
                  text: dictation.interim || t("dictation.hintGrok"),
                })}
              </p>
            )}
            {dictation.state === "processing" && (
              <p className="mx-auto mt-1 max-w-[46rem] text-2xs text-muted-foreground">
                {t("dictation.processing")}
              </p>
            )}
            {dictation.error && (
              <p className="mx-auto mt-1 max-w-[46rem] text-2xs text-destructive-text">
                {dictation.error.startsWith("dictation.")
                  ? t(dictation.error)
                  : dictation.error}
              </p>
            )}
            <p className="mx-auto mt-1.5 max-w-[46rem] text-2xs text-muted-foreground">
              {t("workspace.enterHint")}
            </p>
          </ConversationComposer>
        )}
      </div>

      {/* Drag handle: rebalance chat | browser */}
      {browserUi.open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("workspace.browserResize")}
          aria-valuenow={Math.round(chatSplitPct)}
          aria-valuemin={28}
          aria-valuemax={58}
          tabIndex={0}
          className={cn(
            "group relative z-20 w-1.5 shrink-0 cursor-col-resize bg-transparent",
            "hover:bg-primary/25 active:bg-primary/40",
            splitDragging && "bg-primary/40",
          )}
          onPointerDown={(e) => {
            e.preventDefault();
            setSplitDragging(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setChatSplitPct((p) => Math.max(28, Math.min(58, p - 2)));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setChatSplitPct((p) => Math.max(28, Math.min(58, p + 2)));
            }
          }}
        >
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 group-hover:bg-primary/50" />
        </div>
      )}

      {/* Agent browser — always to the right of chat when open */}
      {browserUi.open && (
        <Suspense
          fallback={
            <div
              className="flex min-w-0 flex-1 items-center justify-center border-l border-white/[0.05] bg-black/20"
              data-testid="browser-pane-loading"
              role="status"
              aria-label={t("common.loading")}
            >
              <Skeleton className="h-24 w-full max-w-sm rounded-xl" />
            </div>
          }
        >
          <BrowserPaneSlot
            taskId={browserSessionId}
            status={browserStatus}
            onBounds={onBrowserBounds}
            onClose={() =>
              setBrowserUi((s) => reduceBrowserUi(s, { type: "user_collapse" }))
            }
            className={cn(
              "animate-fade-in",
              splitDragging && "pointer-events-none",
            )}
          />
        </Suspense>
      )}

      {/* Context rail: deliverables + workspace (auto-hidden while browser is open) */}
      <aside
        className={cn(
          "w-[280px] shrink-0 flex-col border-l border-white/[0.05] bg-black/15",
          railVisible ? "flex" : "hidden",
        )}
      >
        <ScrollArea className="flex-1 p-4">
          <WorkspaceSection
            title={t("workspace.deliverables")}
            trailing={
              deliverables.length > 0 ? (
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {deliverables.length}
                </span>
              ) : null
            }
          >
            {deliverables.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {isLive
                  ? t("workspace.deliverablesLive")
                  : t("workspace.deliverablesEmpty")}
              </p>
            ) : (
              <div className="space-y-2">
                {deliverableGroups.hero ? (
                  <DeliverableRow
                    d={deliverableGroups.hero}
                    onOpen={openFile}
                    onOpenInBrowser={openHtmlInAgentBrowser}
                    root={root}
                    hero
                  />
                ) : null}
                {deliverableGroups.principal.length > 0 ? (
                  <ul className="space-y-0.5">
                    {deliverableGroups.principal.map((d) => (
                      <li key={d.key}>
                        <DeliverableRow
                          d={d}
                          onOpen={openFile}
                          onOpenInBrowser={openHtmlInAgentBrowser}
                          root={root}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {deliverableGroups.overflow.length > 0 ? (
                  <details className="group rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                    <summary className="cursor-pointer list-none text-2xs font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-1">
                        {t("workspace.allFiles", { n: deliverables.length })}
                        <span className="transition-transform group-open:rotate-90">
                          ›
                        </span>
                      </span>
                    </summary>
                    <ul className="mt-1.5 space-y-0.5">
                      {deliverableGroups.overflow.map((d) => (
                        <li key={d.key}>
                          <DeliverableRow
                            d={d}
                            onOpen={openFile}
                            onOpenInBrowser={openHtmlInAgentBrowser}
                            root={root}
                          />
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )}
          </WorkspaceSection>

          <WorkspaceSection title={t("workspace.railWorkspace")}>
            <Card className="shadow-none">
              <CardContent className="space-y-2.5 p-3 text-xs">
                <div
                  className={
                    displayWorkspaceRoot
                      ? "break-all font-mono text-2xs text-muted-foreground"
                      : "text-2xs text-muted-foreground"
                  }
                  title={displayWorkspaceRoot || undefined}
                >
                  {displayWorkspaceRoot
                    ? shortPath(displayWorkspaceRoot)
                    : t("workspace.managedWorkspaceLabel")}
                </div>
                <p className="text-2xs text-muted-foreground">
                  {approvalLabel(task.policySnapshot.approvalMode)}
                  {" · "}
                  {formatDateTime(task.updatedAt)}
                </p>
                {(isLive || !isTerminal) && task.policySnapshot ? (
                  <ProtectionChip
                    view={projectProtectionChip(
                      protectionInputFromTask({
                        policy: task.policySnapshot,
                        // Fail closed until spawn protection event arrives (T3 honesty).
                        supportsSandbox: false,
                        spawnProtection: protectionFromEvents(props.events),
                      }),
                    )}
                    className="w-full"
                  />
                ) : null}
                {isLive ? (
                  <DegradedModeLabel
                    view={projectDegradedModeView({
                      // Prefer ACP when events include protection (session started);
                      // without ACP streams the engine is headless-degraded.
                      transport: props.events.some(
                        (e) =>
                          e.kind === "plan_update" ||
                          e.kind === "worker_started",
                      )
                        ? "acp"
                        : "headless",
                    })}
                  />
                ) : null}
                <ContextMeter
                  usage={contextUsage}
                  liveRatio={
                    acpSessionStatus
                      ? projectSessionStatusHeader(acpSessionStatus).contextRatio
                      : null
                  }
                  compactAvailable={compactAvailable && isLive}
                  onCompact={() => {
                    void taskCompact(task.id).then((r) => {
                      if (!r.ok) {
                        toast({
                          description: t("workspace.summarizeUnavailable"),
                          variant: "destructive",
                        });
                      }
                    });
                  }}
                />
                {displayWorkspaceRoot && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      void openInFileManager(displayWorkspaceRoot)
                    }
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t("workspace.openFolder")}
                  </Button>
                )}
              </CardContent>
            </Card>
          </WorkspaceSection>
        </ScrollArea>
      </aside>

      {/* Roomy file preview: images, markdown, and syntax-highlighted code */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent
          side="right"
          className="flex h-full w-full max-w-2xl flex-col gap-0 overflow-hidden border-white/10 p-0"
        >
          <SheetHeader className="flex shrink-0 flex-row items-center justify-between gap-2 space-y-0 border-b border-border/60 px-5 py-3 pr-12 text-left">
            <SheetTitle className="min-w-0 flex-1 truncate text-base font-medium">
              {preview?.name ??
                (selectedPath
                  ? fileName(selectedPath)
                  : t("workspace.preview"))}
            </SheetTitle>
            {selectedPath && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                onClick={() => void openInFileManager(selectedPath)}
              >
                {t("workspace.openInFinder")}
              </Button>
            )}
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-5 py-4">
              {previewLoading ? (
                <div className="space-y-2.5">
                  <Skeleton className="h-3.5 w-[90%]" />
                  <Skeleton className="h-3.5 w-[78%]" />
                  <Skeleton className="h-3.5 w-[85%]" />
                  <Skeleton className="h-3.5 w-[60%]" />
                  <Skeleton className="mt-4 h-3.5 w-[82%]" />
                  <Skeleton className="h-3.5 w-[70%]" />
                </div>
              ) : previewImage ? (
                selectedPath && isVideoPath(selectedPath) ? (
                  <video
                    className="mx-auto max-h-[80vh] w-full cursor-zoom-in rounded-lg bg-black"
                    src={videoDisplaySrc(previewImage)}
                    controls
                    playsInline
                    preload="metadata"
                    onDoubleClick={() => setMediaLightboxOpen(true)}
                  />
                ) : (
                  <button
                    type="button"
                    className="mx-auto block w-full cursor-zoom-in"
                    onClick={() => setMediaLightboxOpen(true)}
                  >
                    <img
                      className="md-img mx-auto max-h-[80vh] object-contain"
                      src={previewImage}
                      alt={selectedPath ? fileName(selectedPath) : "image"}
                    />
                  </button>
                )
              ) : preview ? (
                <FilePreviewBody
                  name={preview.name}
                  content={preview.content}
                  truncated={preview.truncated}
                  baseDir={root ?? null}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("workspace.selectFilePreview")}
                </p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {mediaLightboxOpen && previewImage ? (
        <Suspense fallback={null}>
          <MediaLightbox
            open={mediaLightboxOpen && Boolean(previewImage)}
            onOpenChange={setMediaLightboxOpen}
            src={previewImage}
            path={selectedPath}
            title={selectedPath ? fileName(selectedPath) : undefined}
            video={Boolean(selectedPath && isVideoPath(selectedPath))}
          />
        </Suspense>
      ) : null}

      {/*
        Thread-wide audit: every turn has its own taskId; filtering only the
        latest would hide prior approvals after a quiet follow-up (fail-closed
        false-negative). WorkspaceAuditDrawer derives all open-chat task ids.
      */}
      <WorkspaceAuditDrawer
        open={auditOpen}
        onOpenChange={setAuditOpen}
        threadTasks={props.threadTasks}
        taskId={task.id}
        taskLabel={props.chatTitle || task.goal}
      />
      {ownedConfirm.dialog}
    </div>
  );
}
