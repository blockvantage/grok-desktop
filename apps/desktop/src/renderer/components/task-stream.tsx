import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  FileText,
  Globe,
  Loader2,
  Sparkles,
  Terminal,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import {
  emptyStreamCopy,
  eventRowIconStatus,
  isTaskActivelyWorking,
} from "@/lib/event-status";
import {
  deriveDeliveryPhase,
  mayShowWorking,
} from "@/lib/delivery-state";
import {
  humanizeTool,
  toolIconKind,
  workingActivity,
} from "@/lib/task-stream-activity";
import {
  collapseEventsToBlocks,
  prepareChatStream,
  type ChatProgressBlock,
  type StreamBlock,
} from "@/lib/stream-view";
import { activityStoreFromEvents } from "@/lib/events-to-activity";
import {
  visibleTimelineEvents,
  workersForHud,
} from "@/lib/activity-store";
import { taskStatusLabel } from "@/lib/labels";
import { isAudioPath, isImagePath, isVideoPath } from "@/lib/api";
import {
  foldStreamArtifactItems,
  type StreamDigestItem,
} from "@/lib/fold-turn-artifacts";
import {
  ArtifactMedia,
  DeliverablesDigestCard,
} from "@/components/deliverables-digest";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { ConversationLoading } from "@/components/conversation-loading";
import { Markdown } from "@/components/ui/markdown-lazy";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useI18n, useT } from "@/i18n";
// Module-level translator: the fold helpers below are pure functions, not hooks.
import { t as translate } from "@/i18n/active";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { TaskEvent } from "@grokdesk/shared";
import type {
  ConversationSnapshot,
  ConversationTurn as ConversationTurnView,
} from "@/lib/conversation-projector";
import { ConversationTurn } from "@/components/conversation/conversation-turn";
import type { RecoveryAction } from "@/lib/error-recovery";
import {
  shouldVirtualizeStream,
  scrollTargetForStream,
  STREAM_VIRTUALIZE_THRESHOLD,
} from "@/lib/stream-virtual";
import { questionChipsForTerminalTurn } from "@/lib/user-question";
import {
  legacyItemsHaveVisibleLiveSignal,
  shouldShowLegacyWorking,
} from "@/lib/task-stream-state";
import {
  approvalTargetForTurn,
  busyDecisionForApproval,
  focusApprovalTarget,
  type ApprovalActionTarget,
  type ApprovalBusyState,
} from "@/lib/approval-action";
import { formatElapsed, taskElapsedStartIso } from "@/lib/elapsed";
import { useElapsedSeconds } from "@/hooks/use-elapsed";
import {
  runningMediaKind,
  type MediaToolKind,
} from "@/lib/media-progress";

export { STREAM_VIRTUALIZE_THRESHOLD };

/** Imperative scroll control for Jump-to-latest / soft-follow with virtualizer. */
export type TaskStreamHandle = {
  scrollToEnd: (behavior?: ScrollBehavior) => void;
  focusApproval: (target: ApprovalActionTarget) => boolean;
  itemCount: () => number;
};

/** chat = conversation only; tools = chat + folded tool rows; log = full work log */
export type StreamDensity = "chat" | "tools" | "log";

/**
 * A tool call collapsed into a single conversational action. The engine emits
 * a request event and a later result event; we fold them into one row so the
 * stream reads as "Read file · config.ts ✓" instead of two log lines.
 */
type ToolAction = {
  kind: "toolAction";
  id: string;
  tool: string;
  detail: string;
  status: "running" | "ok" | "failed";
  output?: string;
  seq: number;
};

type RenderItem =
  | { kind: "block"; id: string; block: StreamBlock }
  | { kind: "progress"; id: string; progress: ChatProgressBlock }
  | ToolAction
  | StreamDigestItem;

export const TaskStream = forwardRef<
  TaskStreamHandle,
  {
    events: TaskEvent[];
    /** First history fetch in flight — logo loader instead of empty copy. */
    eventsLoading?: boolean;
    taskStatus: string;
    /**
     * Gateway has accepted this task row. False for optimistic placeholders so
     * Working never lights from an unaccepted create (Task 10).
     */
    deliveryAccepted?: boolean;
    density?: StreamDensity;
    isLive?: boolean;
    baseDir?: string | null;
    onOpenFile?: (path: string) => void;
    /** Focus the deliverables rail (digest "Open deliverables"). */
    onOpenDeliverables?: () => void;
    /** Open assistant/citation links in the task-partitioned Desk browser. */
    onOpenUrl?: (url: string) => void;
    /**
     * Run start ISO for PROG-1 elapsed. Prefer task.createdAt (attempt start is
     * not on the Task payload — see taskElapsedStartIso).
     */
    elapsedStartIso?: string | null;
    /** Answer a multi-choice question chip (sends a follow-up turn). */
    onAnswerQuestion?: (label: string) => void;
    /** When true, chips are disabled so double-click cannot fire two turns (CH-8). */
    followUpBusy?: boolean;
    /** Canonical conversation projection. Chat density renders this calm view. */
    conversation?: ConversationSnapshot | null;
    /** Only this accepted turn may expose Edit. */
    editableTaskId?: string | null;
    onEditConversationTurn?: (turn: ConversationTurnView) => void;
    /** CHAT-6: save an inline user-message edit as a revision. */
    onSaveConversationTurnEdit?: (
      turn: ConversationTurnView,
      text: string,
    ) => void | Promise<void>;
    /** CHAT-1: re-run a terminal turn's user message as a follow-up. */
    onRetryConversationTurn?: (turn: ConversationTurnView) => void | Promise<void>;
    /** CHAT-6: task id whose user bubble is frozen while regenerating. */
    regeneratingTaskId?: string | null;
    onApprove?: (target: ApprovalActionTarget) => void | Promise<void>;
    onReject?: (target: ApprovalActionTarget) => void | Promise<void>;
    approvalBusy?: ApprovalBusyState;
    onRecoveryAction?: (action: RecoveryAction, turnId: string) => void;
    onUndoTurn?: (turn: ConversationTurnView) => void | Promise<void>;
    /**
     * CHAT-4: first unseen event seq when reopening a task. Render a "New"
     * separator above the first item at/after this seq. Null = no boundary.
     */
    unreadBoundarySeq?: number | null;
    /** CHAT-4: conversation turn id that owns the first unseen content. */
    firstUnreadTurnId?: string | null;
  }
>(function TaskStream(
  {
    events,
    eventsLoading = false,
    taskStatus,
    deliveryAccepted = true,
    density = "chat",
    isLive = false,
    baseDir = null,
    onOpenFile,
    onOpenDeliverables,
    onOpenUrl,
    elapsedStartIso = null,
    onAnswerQuestion,
    followUpBusy = false,
    conversation = null,
    editableTaskId = null,
    onEditConversationTurn,
    onSaveConversationTurnEdit,
    onRetryConversationTurn,
    regeneratingTaskId = null,
    onApprove,
    onReject,
    approvalBusy = {},
    onRecoveryAction,
    onUndoTurn,
    unreadBoundarySeq = null,
    firstUnreadTurnId = null,
  },
  ref,
) {
  const { locale } = useI18n();
  const listScrollRef = useRef<TaskStreamHandle | null>(null);
  const canonicalRootRef = useRef<HTMLDivElement | null>(null);
  /** CH-5: only animate items newer than first paint (virtualizer remounts otherwise replay). */
  const entranceBaselineSeq = useRef<number | null>(null);
  const blocks = useMemo(
    () => collapseEventsToBlocks(events),
    // locale: stream labels use module-level t()
    [events, locale],
  );

  // Progressive activity model (Conversation/Run/Worker/ActivityEvent).
  const activityStore = useMemo(() => {
    const runId =
      (events[0] as { taskId?: string } | undefined)?.taskId ?? "run";
    return activityStoreFromEvents(
      events as Array<{
        id: string;
        kind: string;
        payload: Record<string, unknown>;
        createdAt?: string;
        taskId?: string;
      }>,
      runId,
    );
  }, [events]);
  const activityTimeline = useMemo(
    () =>
      visibleTimelineEvents(activityStore, {
        includeTools: density === "tools" || density === "log",
        includeLogs: density === "log",
      }),
    [activityStore, density],
  );
  // Truthful workers only — hide HUD when engine never emitted worker_* events.
  void workersForHud(activityStore);

  // Working only after authoritative acceptance while status is running (Task 10).
  const deliveryPhase = deriveDeliveryPhase({
    taskStatus,
    accepted: deliveryAccepted,
    saving: !deliveryAccepted,
  });
  const active =
    mayShowWorking(deliveryPhase) && isTaskActivelyWorking(taskStatus);

  // PROG-1: attempt startedAt is not on Task; prefer explicit prop, else first
  // event timestamp (stream birth) — see taskElapsedStartIso comment.
  const resolvedElapsedStart =
    elapsedStartIso ??
    taskElapsedStartIso({
      createdAt: events[0]?.createdAt,
      updatedAt: undefined,
    });
  const elapsedSeconds = useElapsedSeconds(resolvedElapsedStart, active);

  // Chat / tools: fold thoughts + intermediate status into one trail.
  // tools density also keeps folded ToolAction rows.
  // Log: full trace including tools/thoughts as discrete rows.
  const chatItems = useMemo(() => {
    if (density === "log") return null;
    const prepared = prepareChatStream(blocks, {
      active,
      taskStatus,
    });
    // Prefer activity live summary for the single working block when available.
    if (active && activityStore.liveSummary) {
      for (let i = prepared.length - 1; i >= 0; i--) {
        const b = prepared[i];
        if (b && b.kind === "progress") {
          (b as ChatProgressBlock & { title?: string }).title =
            activityStore.liveSummary;
          break;
        }
      }
    }
    // Hide raw tool/thought noise in conversation; tools density re-adds tools
    // via foldStreamFromChat + merge below. Approvals/questions stay in order.
    const visible = prepared.filter((b) => {
      if (b.kind === "progress") return true;
      return (
        b.kind === "assistant" ||
        b.kind === "user" ||
        b.kind === "artifact" ||
        b.kind === "error" ||
        b.kind === "approval" ||
        (density === "tools" && b.kind === "tool")
      );
    });
    // Fold completed activity phases into readable summary chips (progressive disclosure).
    const phases = activityTimeline.filter((e) => e.kind === "phase");
    if (phases.length > 0 && density === "chat") {
      for (const p of phases) {
        visible.push({
          id: p.id,
          kind: "meta",
          label: p.summary,
          seq: Date.parse(p.timestamp) || 0,
        } as StreamBlock);
      }
    }
    return foldStreamFromChat(visible);
  }, [
    blocks,
    density,
    active,
    taskStatus,
    activityStore.liveSummary,
    activityTimeline,
  ]);

  const logItems = useMemo(() => {
    if (density !== "log") return null;
    return foldStream(blocks);
  }, [blocks, density]);

  const items = density === "log" ? logItems! : chatItems!;

  // Fold the *full* stream too, so the working heartbeat can name the live
  // action (e.g. "Read file") even when the conversation hides tool rows.
  const allItems = useMemo(() => foldStream(blocks), [blocks]);

  const lastAll = allItems[allItems.length - 1];
  const lastChatAssistant = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.kind === "block" && it.block.kind === "assistant") return it;
    }
    return null;
  }, [items]);
  const streamingAssistant =
    active &&
    lastChatAssistant != null &&
    lastAll?.kind === "block" &&
    lastAll.block.kind === "assistant";
  // Keep a live pulse while running — Grok Build often runs tools without
  // streaming tool_use events, so the UI would otherwise freeze on the last
  // thought line for minutes.
  const hasLiveProgress = items.some(
    (it) => it.kind === "progress" && it.progress.live,
  );
  // CH-4: exactly one live signal; suppressed progress cannot hide a running tool.
  const t = useT();
  // PROG-3: concrete tool label always wins; run_progress / liveSummary as caption
  // (never flip back to rotating generic lines while a tool is open).
  const liveProgressCaption = useMemo(() => {
    if (activityStore.liveSummary) return activityStore.liveSummary;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it?.kind === "progress" && it.progress.live) {
        const titled = (it.progress as ChatProgressBlock & { title?: string })
          .title;
        if (titled?.trim()) return titled.trim();
        const last = it.progress.lines.at(-1)?.text?.trim();
        if (last) return last;
      }
    }
    return null;
  }, [activityStore.liveSummary, items]);
  const activity = useMemo((): Activity => {
    const fromStream = workingActivity(lastAll, t, allItems);
    if (!fromStream.generic) {
      return {
        ...fromStream,
        caption: liveProgressCaption ?? undefined,
      };
    }
    if (liveProgressCaption) {
      return {
        label: liveProgressCaption,
        generic: false,
      };
    }
    if (hasLiveProgress) {
      return { label: t("stream.stillWorking"), generic: true };
    }
    return fromStream;
  }, [lastAll, allItems, hasLiveProgress, liveProgressCaption, t]);

  // PROG-2: newest running media tool → replace dots with media card.
  const mediaKind = useMemo(() => {
    const tools = allItems
      .filter((it): it is ToolAction => it.kind === "toolAction")
      .map((it) => ({
        tool: it.tool,
        status: it.status,
        detail: it.detail,
      }));
    return runningMediaKind(tools);
  }, [allItems]);

  // Live: media + newest non-media. Ended: one turn-end digest (ASSET-3).
  const renderItems = useMemo(
    () =>
      foldStreamArtifactItems(
        items,
        { live: active },
        (it): it is Extract<RenderItem, { kind: "block" }> & {
          block: Extract<StreamBlock, { kind: "artifact" }>;
        } => it.kind === "block" && it.block.kind === "artifact",
      ),
    [items, active],
  );
  const visibleLiveSignal = legacyItemsHaveVisibleLiveSignal(renderItems);
  // Media card replaces WorkingIndicator entirely (CH-4: one live signal). When
  // a media tool is running, suppress the tool-row live signal so the card can
  // own the slot — tool rows still exist in tools density but the media card
  // is the stream-level signal for rendering ETA.
  const showWorking = shouldShowLegacyWorking({
    active,
    streamingAssistant,
    visibleLiveSignal: mediaKind ? false : visibleLiveSignal,
  });

  const emptyChat =
    (density === "chat" || density === "tools") &&
    (events.length === 0 || renderItems.length === 0);
  const emptyLog = density === "log" && (events.length === 0 || blocks.length === 0);
  const empty = emptyChat || emptyLog;

  useImperativeHandle(
    ref,
    () => ({
      scrollToEnd: (behavior) => {
        if (conversation && density !== "log") {
          const root = canonicalRootRef.current;
          const viewport = root?.closest<HTMLElement>(
            "[data-radix-scroll-area-viewport]",
          );
          if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior });
          }
          return;
        }
        if (empty) return;
        listScrollRef.current?.scrollToEnd(behavior);
      },
      focusApproval: (target) =>
        focusApprovalTarget(canonicalRootRef.current, target),
      itemCount: () =>
        conversation && density !== "log"
          ? conversation.turns.length
          : empty
            ? 0
            : (listScrollRef.current?.itemCount() ?? renderItems.length),
    }),
    [conversation, density, renderItems.length, empty],
  );

  const questionChips = useMemo(() => {
    if (isLive || !onAnswerQuestion) return null;
    const blocksForQ = renderItems
      .filter(
        (it): it is Extract<RenderItem, { kind: "block" }> =>
          it.kind === "block",
      )
      .map((it) => ({
        kind: it.block.kind,
        id: it.id,
        text:
          "text" in it.block && typeof it.block.text === "string"
            ? it.block.text
            : undefined,
      }));
    return questionChipsForTerminalTurn(blocksForQ, taskStatus);
  }, [renderItems, taskStatus, isLive, onAnswerQuestion]);

  // Capture baseline once so historical rows never re-play entrance.
  if (entranceBaselineSeq.current == null && renderItems.length > 0) {
    let max = 0;
    for (const it of renderItems) {
      const seq =
        it.kind === "toolAction"
          ? it.seq
          : it.kind === "progress"
            ? it.progress.seq
            : it.kind === "artifact_digest"
              ? it.seq
              : it.block.seq;
      if (seq > max) max = seq;
    }
    entranceBaselineSeq.current = max;
  }
  const animateAfterSeq = entranceBaselineSeq.current ?? Number.POSITIVE_INFINITY;

  if (conversation && density !== "log") {
    if (eventsLoading) {
      return (
        <div ref={canonicalRootRef} data-canonical-conversation>
          <ConversationLoading />
        </div>
      );
    }
    const latestTurn = conversation.turns.at(-1) ?? null;
    const latestQuestion =
      latestTurn?.answer && !isLive && onAnswerQuestion
        ? questionChipsForTerminalTurn(
            [
              {
                kind: "assistant",
                id: latestTurn.answer.eventId,
                text: latestTurn.answer.text,
              },
            ],
            latestTurn.state,
          )
        : null;
    // PROG-3: surface liveSummary on the active turn's LiveWorkCard only.
    const liveCaption = active ? activityStore.liveSummary : null;

    return (
      <div
        ref={canonicalRootRef}
        className="flex w-full flex-col gap-6"
        data-canonical-conversation
      >
        {conversation.turns.length === 0 ? (
          <EmptyStreamState taskStatus={taskStatus} />
        ) : (
          conversation.turns.map((turn) => {
            const approvalTarget = approvalTargetForTurn(turn);
            const actionableApproval =
              turn.state === "waiting_approval" && approvalTarget !== null;
            const isLatest = turn.id === latestTurn?.id;
            const showUnread =
              firstUnreadTurnId != null && turn.id === firstUnreadTurnId;
            return (
              <div key={turn.id} className="flex flex-col gap-6">
                {showUnread ? <UnreadBoundarySeparator label={t("stream.newSince")} /> : null}
                <ConversationTurn
                  turn={turn}
                  onOpenFile={onOpenFile}
                  onOpenDeliverables={onOpenDeliverables}
                  onOpenUrl={onOpenUrl}
                  baseDir={baseDir}
                  onEdit={
                    onEditConversationTurn && turn.taskId === editableTaskId
                      ? onEditConversationTurn
                      : undefined
                  }
                  onSaveEdit={
                    onSaveConversationTurnEdit && turn.taskId === editableTaskId
                      ? onSaveConversationTurnEdit
                      : undefined
                  }
                  onRetryTurn={onRetryConversationTurn}
                  regenerating={regeneratingTaskId === turn.taskId}
                  onApprove={actionableApproval ? onApprove : undefined}
                  onReject={actionableApproval ? onReject : undefined}
                  approvalBusy={busyDecisionForApproval(approvalBusy, approvalTarget)}
                  question={isLatest ? latestQuestion : null}
                  onAnswerQuestion={
                    isLatest ? onAnswerQuestion : undefined
                  }
                  answerBusy={followUpBusy}
                  onRecoveryAction={onRecoveryAction}
                  onUndoTurn={onUndoTurn}
                  activityCaption={isLatest ? liveCaption : null}
                />
              </div>
            );
          })
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="mx-auto w-full max-w-[46rem] pb-4">
        {eventsLoading ? (
          <ConversationLoading />
        ) : active ? (
          // Live empty stream: never hardcode "Getting started" — rotate
          // friendly working lines while the engine is quiet (tools often
          // produce no stream events from Grok Build).
          <WorkingIndicator
            activity={{ label: "", generic: true }}
            elapsedSeconds={elapsedSeconds}
            mediaKind={null}
          />
        ) : (
          <EmptyStreamState taskStatus={taskStatus} />
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <StreamItemList
        ref={listScrollRef}
        items={renderItems}
        active={active}
        lastChatAssistantId={lastChatAssistant?.id ?? null}
        baseDir={baseDir}
        onOpenFile={onOpenFile}
        onOpenDeliverables={onOpenDeliverables}
        onOpenUrl={onOpenUrl}
        showWorking={showWorking}
        activity={activity}
        elapsedSeconds={elapsedSeconds}
        mediaKind={mediaKind}
        animateAfterSeq={animateAfterSeq}
        unreadBoundarySeq={unreadBoundarySeq}
        unreadLabel={t("stream.newSince")}
      />
      {questionChips && onAnswerQuestion && (
        <div
          className="mx-auto flex w-full max-w-[46rem] flex-col gap-2 px-0.5"
          data-question-chips
        >
          <div className="text-sm font-medium leading-snug text-foreground/90">
            {questionChips.prompt || t("workspace.questionPick")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {questionChips.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={followUpBusy}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-left text-xs font-medium text-foreground/90 transition-colors hover:border-primary/35 hover:bg-primary/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                onClick={() => onAnswerQuestion(opt.label)}
              >
                {followUpBusy ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {opt.label}
                  </span>
                ) : (
                  opt.label
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

const StreamItemList = forwardRef<
  TaskStreamHandle,
  {
    items: RenderItem[];
    active: boolean;
    lastChatAssistantId: string | null;
    baseDir: string | null;
    onOpenFile?: (path: string) => void;
    onOpenDeliverables?: () => void;
    onOpenUrl?: (url: string) => void;
    showWorking: boolean;
    activity: Activity;
    elapsedSeconds: number;
    mediaKind: MediaToolKind | null;
    animateAfterSeq: number;
    unreadBoundarySeq?: number | null;
    unreadLabel?: string;
  }
>(function StreamItemList(
  {
    items,
    active,
    lastChatAssistantId,
    baseDir,
    onOpenFile,
    onOpenDeliverables,
    onOpenUrl,
    showWorking,
    activity,
    elapsedSeconds,
    mediaKind,
    animateAfterSeq,
    unreadBoundarySeq = null,
    unreadLabel = "New",
  },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const useVirtual = shouldVirtualizeStream(items.length);
  const getScrollElement = () => {
    const el = parentRef.current;
    if (!el) return null;
    return (
      (el.closest(
        "[data-radix-scroll-area-viewport]",
      ) as HTMLElement | null) ?? el
    );
  };
  const virtualizer = useVirtualizer({
    count: useVirtual ? items.length : 0,
    getScrollElement,
    estimateSize: () => 96,
    overscan: 8,
  });

  useImperativeHandle(
    ref,
    () => ({
      itemCount: () => items.length,
      focusApproval: () => false,
      scrollToEnd: (behavior: ScrollBehavior = "auto") => {
        const target = scrollTargetForStream({
          itemCount: items.length,
          virtualize: useVirtual,
        });
        if (target.mode === "index") {
          virtualizer.scrollToIndex(target.index, {
            align: "end",
            behavior: behavior === "smooth" ? "smooth" : "auto",
          });
          // After measure, pin viewport to absolute bottom.
          requestAnimationFrame(() => {
            const vp = getScrollElement();
            if (vp) {
              if (behavior === "smooth") {
                vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" });
              } else {
                vp.scrollTop = vp.scrollHeight;
              }
            }
          });
          return;
        }
        const vp = getScrollElement();
        if (!vp) return;
        if (behavior === "smooth") {
          vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" });
        } else {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const v = getScrollElement();
              if (v) v.scrollTop = v.scrollHeight;
            });
          });
        }
      },
    }),
    [items.length, useVirtual, virtualizer],
  );

  const itemSeq = (it: RenderItem) =>
    it.kind === "toolAction"
      ? it.seq
      : it.kind === "progress"
        ? it.progress.seq
        : it.kind === "artifact_digest"
          ? it.seq
          : it.block.seq;
  const shouldAnimate = (it: RenderItem) =>
    active && itemSeq(it) > animateAfterSeq;

  // First visible item at/after the unread boundary (folding may skip exact seq).
  const firstUnreadItemId =
    unreadBoundarySeq == null
      ? null
      : (items.find(
          (it) => it.kind !== "progress" && itemSeq(it) >= unreadBoundarySeq,
        )?.id ?? null);

  const renderOne = (it: RenderItem) => {
    const body =
      it.kind === "toolAction" ? (
        <Gutter>
          <ToolActionRow action={it} active={active} animate={shouldAnimate(it)} />
        </Gutter>
      ) : it.kind === "progress" ? null : it.kind === "artifact_digest" ? (
        <Gutter>
          <DeliverablesDigestCard
            media={it.media}
            moreCount={it.moreCount}
            onOpenFile={onOpenFile}
            onOpenDeliverables={onOpenDeliverables}
            baseDir={baseDir}
          />
        </Gutter>
      ) : (
        <StreamTurn
          block={it.block}
          streaming={
            active &&
            it.block.kind === "assistant" &&
            lastChatAssistantId === it.id
          }
          baseDir={baseDir}
          onOpenFile={onOpenFile}
          onOpenUrl={onOpenUrl}
          animate={shouldAnimate(it)}
        />
      );
    if (body == null) return null;
    const showUnread = firstUnreadItemId != null && it.id === firstUnreadItemId;
    return (
      <div key={it.id} className="flex flex-col gap-3">
        {showUnread ? (
          <UnreadBoundarySeparator label={unreadLabel} />
        ) : null}
        {body}
      </div>
    );
  };

  if (!useVirtual) {
    return (
      <div
        ref={parentRef}
        className="mx-auto flex w-full max-w-[46rem] flex-col gap-3 pb-4"
        data-stream-virtual="off"
      >
        {items.map(renderOne)}
        {showWorking && (
          <WorkingIndicator
            activity={activity}
            elapsedSeconds={elapsedSeconds}
            mediaKind={mediaKind}
          />
        )}
      </div>
    );
  }

  const vItems = virtualizer.getVirtualItems();
  return (
    <div
      ref={parentRef}
      className="mx-auto w-full max-w-[46rem] pb-4"
      data-stream-virtual="on"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {vItems.map((vRow) => {
          const it = items[vRow.index]!;
          return (
            <div
              key={it.id}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-3"
              style={{ transform: `translateY(${vRow.start}px)` }}
            >
              {renderOne(it)}
            </div>
          );
        })}
      </div>
      {showWorking && (
        <WorkingIndicator
          activity={activity}
          elapsedSeconds={elapsedSeconds}
          mediaKind={mediaKind}
        />
      )}
    </div>
  );
});

/** Fold tools inside chat items that may include progress groups. */
function foldStreamFromChat(
  items: Array<StreamBlock | ChatProgressBlock>,
): RenderItem[] {
  const out: RenderItem[] = [];
  for (const b of items) {
    if (b.kind === "progress") {
      out.push({ kind: "progress", id: b.id, progress: b });
      continue;
    }
    if (b.kind === "tool" && b.phase === "result") {
      let matched = false;
      for (let i = out.length - 1; i >= 0; i--) {
        const prev = out[i];
        if (prev.kind === "toolAction" && prev.status === "running") {
          prev.status = b.ok === false ? "failed" : "ok";
          prev.output = b.detail;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      out.push({
        kind: "toolAction",
        id: b.id,
        tool: translate("stream.toolResult"),
        detail: "",
        status: b.ok === false ? "failed" : "ok",
        output: b.detail,
        seq: b.seq,
      });
      continue;
    }
    if (b.kind === "tool" && b.phase === "request") {
      out.push({
        kind: "toolAction",
        id: b.id,
        tool: b.tool,
        detail: b.detail,
        status: "running",
        seq: b.seq,
      });
      continue;
    }
    out.push({ kind: "block", id: b.id, block: b });
  }
  return out;
}

/** Fold consecutive tool request/result events into single action rows. */
function foldStream(blocks: StreamBlock[]): RenderItem[] {
  const items: RenderItem[] = [];
  for (const b of blocks) {
    if (b.kind === "tool" && b.phase === "result") {
      // Attach to the most recent action still awaiting its result.
      let matched = false;
      for (let i = items.length - 1; i >= 0; i--) {
        const prev = items[i];
        if (prev.kind === "toolAction" && prev.status === "running") {
          prev.status = b.ok === false ? "failed" : "ok";
          prev.output = b.detail;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      // Orphan result (no preceding request) — show it standalone.
      items.push({
        kind: "toolAction",
        id: b.id,
        tool: translate("stream.toolResult"),
        detail: "",
        status: b.ok === false ? "failed" : "ok",
        output: b.detail,
        seq: b.seq,
      });
      continue;
    }
    if (b.kind === "tool" && b.phase === "request") {
      items.push({
        kind: "toolAction",
        id: b.id,
        tool: b.tool,
        detail: b.detail,
        status: "running",
        seq: b.seq,
      });
      continue;
    }
    items.push({ kind: "block", id: b.id, block: b });
  }
  return items;
}

/** Left-gutter alignment so tool/thought rows sit under Grok's messages. */
/** CHAT-4: hairline "New" separator above the first unseen item. */
function UnreadBoundarySeparator({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 py-1"
      data-unread-boundary
      role="separator"
      aria-label={label}
    >
      <div className="h-px flex-1 bg-primary/40" />
      <span className="shrink-0 text-2xs font-semibold uppercase tracking-wide text-primary">
        {label}
      </span>
      <div className="h-px flex-1 bg-primary/40" />
    </div>
  );
}

function Gutter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 shrink-0" />
      {children}
    </div>
  );
}

function EmptyStreamState({ taskStatus }: { taskStatus: string }) {
  const copy = emptyStreamCopy(taskStatus);
  return (
    <EmptyState
      icon={
        copy.spinning ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : taskStatus === "failed" ? (
          <AlertCircle className="h-5 w-5" />
        ) : taskStatus === "done" ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Circle className="h-5 w-5" />
        )
      }
      title={copy.title}
      description={copy.description}
      className="py-14"
    />
  );
}

function StreamTurn({
  block,
  streaming,
  baseDir,
  onOpenFile,
  onOpenUrl,
  animate = false,
}: {
  block: StreamBlock;
  streaming: boolean;
  baseDir: string | null;
  onOpenFile?: (path: string) => void;
  onOpenUrl?: (url: string) => void;
  animate?: boolean;
}) {
  const t = useT();
  switch (block.kind) {
    case "assistant":
      return (
        <div className={cn(animate && "chat-msg-in", "group flex gap-3")}>
          <GrokAvatar />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground/90">
                Grok
              </span>
              {!streaming && (
                <CopyButton
                  text={block.text}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                />
              )}
            </div>
            <div className={cn(streaming && "stream-caret")}>
              <Markdown baseDir={baseDir} onOpenUrl={onOpenUrl}>{block.text}</Markdown>
            </div>
          </div>
        </div>
      );

    case "user":
      return (
        <div className={cn(animate && "chat-msg-in", "flex justify-end gap-3")}>
          <div className="min-w-0 max-w-[70%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.12] px-3.5 py-2.5">
            <Markdown className="text-base" baseDir={baseDir} onOpenUrl={onOpenUrl}>
              {block.text}
            </Markdown>
          </div>
          <Avatar className="mt-0.5 h-7 w-7 ring-1 ring-white/10">
            <AvatarFallback className="bg-white/[0.06] text-muted-foreground">
              <User className="h-3.5 w-3.5" strokeWidth={1.75} />
            </AvatarFallback>
          </Avatar>
        </div>
      );

    case "thought":
      return (
        <Gutter>
          <Collapsible className={cn(animate && "chat-msg-in", "group min-w-0 flex-1")}>
            <CollapsibleTrigger className="flex items-center gap-2 rounded-lg py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground/80">
              <Brain className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
              <span className="font-medium">
                {t("stream.thoughtForAMoment")}
              </span>
              <ChevronRight className="h-3.5 w-3.5 opacity-60 transition-transform group-data-[state=open]:rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 border-l-2 border-white/[0.07] pl-3 text-sm leading-relaxed text-muted-foreground/90">
                <Markdown baseDir={baseDir} onOpenUrl={onOpenUrl}>{block.text}</Markdown>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Gutter>
      );

    case "artifact":
      return (
        <Gutter>
          <ArtifactTurn
            block={block}
            onOpenFile={onOpenFile}
            baseDir={baseDir}
          />
        </Gutter>
      );

    case "approval":
      return (
        <Gutter>
          <div
            className={cn(
              animate && "chat-msg-in",
              "approval-arrive min-w-0 flex-1 rounded-xl border border-warning/35 bg-warning/[0.08] px-3.5 py-2.5",
            )}
            data-testid="approval-card"
            data-effect={block.effectClass}
            role="region"
            aria-label={t("stream.needsApproval")}
          >
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-warning">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {t("stream.needsApproval")}
              {block.scope ? (
                <span className="rounded bg-warning/15 px-1.5 py-0.5 text-2xs font-normal">
                  {block.scope === "once"
                    ? t("approvalCard.once")
                    : block.scope === "always"
                      ? t("approvalCard.always")
                      : t("approvalCard.session")}
                </span>
              ) : null}
            </div>
            {block.what ? (
              <div className="text-sm leading-relaxed text-warning" data-testid="approval-what">
                <span className="text-warning/70">{t("approvalCard.what")}: </span>
                {block.what}
              </div>
            ) : block.reason ? (
              <div className="text-sm leading-relaxed text-warning">
                {block.reason}
              </div>
            ) : null}
            {block.where ? (
              <div
                className="mt-1 truncate font-mono text-xs text-warning/80"
                data-testid="approval-where"
              >
                <span className="font-sans text-warning/70">
                  {t("approvalCard.where")}:{" "}
                </span>
                {block.where}
              </div>
            ) : block.detail ? (
              <div className="mt-1.5 truncate font-mono text-xs text-warning/80">
                {block.detail}
              </div>
            ) : null}
            {block.why ? (
              <div
                className="mt-1.5 text-xs leading-relaxed text-warning/90"
                data-testid="approval-why"
              >
                <span className="text-warning/70">{t("approvalCard.why")}: </span>
                {block.why}
              </div>
            ) : null}
          </div>
        </Gutter>
      );

    case "error":
      return (
        <Gutter>
          <div className={cn(animate && "chat-msg-in", "min-w-0 flex-1 rounded-xl border border-destructive/40 bg-destructive/[0.07] px-3.5 py-2.5 text-sm leading-relaxed text-destructive-text")}>
            {block.message}
          </div>
        </Gutter>
      );

    case "step": {
      const finished = eventRowIconStatus("step", { status: block.status }) === "done";
      return (
        <div className="flex items-center gap-2 pl-11 text-xs text-muted-foreground">
          <StatusIcon status={finished ? "done" : "running"} />
          <span className="font-medium text-foreground/75">{block.title}</span>
          <span>
            {finished ? t("stream.stepFinished") : t("stream.stepStarted")}
          </span>
        </div>
      );
    }

    case "status":
      return (
        <div className="flex justify-center py-0.5">
          <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-2xs text-muted-foreground">
            {taskStatusLabel(block.status)}
          </span>
        </div>
      );

    case "meta":
      return (
        <div
          className={cn(
            "pl-11 text-xs",
            block.tone === "success" && "font-medium text-success",
            block.tone === "danger" &&
              "font-medium text-destructive-text",
            (!block.tone || block.tone === "muted") &&
              "text-muted-foreground",
          )}
          data-meta-tone={block.tone ?? "muted"}
        >
          {block.label}
        </div>
      );

    default:
      return null;
  }
}

function GrokAvatar({ working = false }: { working?: boolean }) {
  return (
    <div
      className={cn(
        // Ice brand fill + soft ice glow
        "relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_6px_16px_-8px_rgba(159,221,255,0.55)]",
        working && "avatar-working",
      )}
    >
      <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
    </div>
  );
}

type Activity = {
  label: string;
  detail?: string;
  /** Latest run_progress / liveSummary caption (PROG-3). */
  caption?: string;
  generic: boolean;
};

/** Live heartbeat pinned to the bottom of the stream while Grok works. */
function WorkingIndicator({
  activity,
  elapsedSeconds = 0,
  mediaKind = null,
}: {
  activity: Activity;
  /** PROG-1 whole seconds since run start; plain text (reduced-motion safe). */
  elapsedSeconds?: number;
  /** PROG-2: when set, replace dots with media rendering card (exactly one signal). */
  mediaKind?: MediaToolKind | null;
}) {
  const t = useT();
  const label = activity.generic
    ? t("thinking.through")
    : activity.label;
  const elapsedLabel = formatElapsed(elapsedSeconds);

  // PROG-2: media card replaces the dots/WorkingIndicator line entirely.
  if (mediaKind) {
    const copyKey =
      mediaKind === "video"
        ? "progress.renderingVideo"
        : "progress.renderingImage";
    return (
      <div
        className="chat-msg-in flex gap-3"
        data-media-progress={mediaKind}
        aria-live="polite"
      >
        <GrokAvatar working />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <div
            className="aspect-video w-full max-w-md overflow-hidden rounded-xl border border-white/[0.07] bg-muted/40"
            aria-hidden="true"
          >
            <div className="h-full w-full bg-gradient-to-br from-muted/70 via-muted/35 to-muted/60" />
          </div>
          <div className="flex max-w-md items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-foreground/90">
              {t(copyKey)}
            </span>
            <span
              className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground"
              data-elapsed
              aria-label={elapsedLabel}
            >
              {elapsedLabel}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-msg-in flex gap-3">
      <GrokAvatar working />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-sm font-medium",
              activity.generic && "thinking-shimmer",
            )}
          >
            {label}
          </span>
          {activity.generic ? (
            <span className="think-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : (
            activity.detail && (
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {tailPath(activity.detail)}
              </span>
            )
          )}
          <span
            className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground"
            data-elapsed
            aria-label={elapsedLabel}
          >
            {elapsedLabel}
          </span>
        </div>
        {activity.caption && !activity.generic ? (
          <span className="truncate text-xs text-muted-foreground">
            {activity.caption}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function toolIcon(tool: string) {
  switch (toolIconKind(tool)) {
    case "globe":
      return Globe;
    case "file":
      return FileText;
    case "trash":
      return Trash2;
    case "terminal":
      return Terminal;
    default:
      return Wrench;
  }
}

function ToolActionRow({
  action,
  active,
  animate = false,
}: {
  action: ToolAction;
  active: boolean;
  animate?: boolean;
}) {
  const running = action.status === "running";
  const failed = action.status === "failed";
  const Icon = toolIcon(action.tool);
  const hasOutput = Boolean(action.output && action.output.trim());
  const [open, setOpen] = useState(failed);

  const iconColor = failed
    ? "text-destructive-text"
    : running
      ? active
        ? "text-primary"
        : "text-muted-foreground"
      : "text-foreground/70";

  return (
    <div
      className={cn(
        animate && "chat-msg-in",
        "min-w-0 flex-1 overflow-hidden rounded-lg border",
        failed
          ? "border-destructive/35 bg-destructive/[0.05]"
          : "border-white/[0.06] bg-white/[0.02]",
      )}
    >
      <button
        type="button"
        onClick={() => hasOutput && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left",
          hasOutput && "cursor-pointer hover:bg-white/[0.02]",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} strokeWidth={1.75} />
        <span className="shrink-0 text-xs font-medium text-foreground/80">
          {action.tool}
        </span>
        {action.detail && (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {action.detail}
          </span>
        )}
        <ToolStatusGlyph status={action.status} active={active} />
        {hasOutput && (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {hasOutput && open && (
        <pre className="max-h-64 overflow-auto border-t border-white/[0.05] px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {action.output}
        </pre>
      )}
    </div>
  );
}

function ToolStatusGlyph({
  status,
  active,
}: {
  status: ToolAction["status"];
  active: boolean;
}) {
  if (status === "failed")
    return <AlertCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-destructive-text" />;
  if (status === "ok")
    return (
      <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-success/80" />
    );
  // running — electric activity (not approval amber)
  return active ? (
    <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-ring" />
  ) : (
    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
  );
}

function ArtifactTurn({
  block,
  onOpenFile,
  baseDir,
}: {
  block: Extract<StreamBlock, { kind: "artifact" }>;
  onOpenFile?: (path: string) => void;
  baseDir?: string | null;
}) {
  const t = useT();
  // Images, video, and audio render embedded — you shouldn't have to click to see the payoff.
  if (
    block.path &&
    (isImagePath(block.path) ||
      isVideoPath(block.path) ||
      isAudioPath(block.path))
  ) {
    return (
      <ArtifactMedia
        path={block.path}
        title={block.title}
        onOpenFile={onOpenFile}
        baseDir={baseDir}
      />
    );
  }
  const clickable = Boolean(block.path && onOpenFile);
  const card = (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => block.path && onOpenFile?.(block.path)}
      className={cn(
        "chat-msg-in flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5 text-left transition-colors",
        clickable && "hover:border-primary/30 hover:bg-primary/[0.06]",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.12] text-primary">
        <FileText className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground/90">
          {block.title}
        </div>
        <div className="text-2xs text-muted-foreground">
          {clickable
            ? t("workspace.deliverableOpenPreview")
            : t("workspace.deliverableLabel")}
        </div>
      </div>
    </button>
  );

  if (!block.path) return card;
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-[22rem] border-white/10 bg-popover">
        <div className="font-mono text-2xs leading-relaxed text-muted-foreground">
          {block.path}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          // clipboard blocked; no-op
        }
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground",
        className,
      )}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" strokeWidth={2} />
          {t("stream.copied")}
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" strokeWidth={1.75} />
          {t("stream.copy")}
        </>
      )}
    </button>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "done")
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === "failed")
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive-text" />;
  return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ring" />;
}

/** Last path segment, for compact "working on" labels. */
function tailPath(s: string): string {
  const clean = s.split(/[?#]/)[0];
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}
