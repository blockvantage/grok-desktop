import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
} from "lucide-react";
import type {
  ConversationTurn as ConversationTurnView,
  WorkerView,
} from "@/lib/conversation-projector";
import { useT } from "@/i18n";
import { Markdown } from "@/components/ui/markdown-lazy";
import { LiveWorkCard } from "./live-work-card";
import { WorkerStrip } from "./worker-strip";
import { WorkDetails } from "./work-details";
import { PlanCard } from "./plan-card";
import { CitationCards } from "./citation-cards";
import {
  ArtifactMedia,
  DeliverablesDigestCard,
} from "@/components/deliverables-digest";
import { foldTurnArtifacts } from "@/lib/fold-turn-artifacts";
import { isAudioPath, isImagePath, isVideoPath } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RecoveryBanner } from "@/components/recovery-banner";
import { cn } from "@/lib/utils";
import {
  recoveryFromErrorMessage,
  type RecoveryAction,
} from "@/lib/error-recovery";
import {
  approvalTargetForTurn,
  restoreApprovalActionFocus,
  runApprovalAction,
  type ApprovalDecision,
  type ApprovalActionTarget,
} from "@/lib/approval-action";
import { isLongAnswer } from "@/lib/conversation-timeline";

const TERMINAL_TURN_STATES = new Set<ConversationTurnView["state"]>([
  "done",
  "failed",
  "cancelled",
]);

export type TurnQuestion = {
  prompt: string;
  options: Array<{ id: string; label: string }>;
};

const LIVE_STATES = new Set<ConversationTurnView["state"]>([
  "running",
  "waiting_user",
  "waiting_approval",
  "blocked",
]);

export function workerListForTurn(
  workers: Record<string, WorkerView>,
): WorkerView[] {
  return Object.values(workers).sort((a, b) => a.id.localeCompare(b.id));
}

export function applyWorkerSelection(input: {
  controlled: boolean;
  workerId: string | null;
  setInternal: (workerId: string | null) => void;
  onChange?: (workerId: string | null) => void;
}) {
  if (!input.controlled) input.setInternal(input.workerId);
  input.onChange?.(input.workerId);
}

/** Compact bubble: mono-highlight a leading /token when present. */
export function UserGoalBubbleText({ text }: { text: string }) {
  const m = text.match(/^(\/[a-zA-Z0-9_-]+)([\s\S]*)?$/);
  if (!m) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }
  return (
    <p className="whitespace-pre-wrap">
      <span className="font-mono text-primary/90">{m[1]}</span>
      {m[2] ?? ""}
    </p>
  );
}

export function ConversationTurn({
  turn,
  onEdit,
  onSaveEdit,
  onRetryTurn,
  onOpenFile,
  onOpenDeliverables,
  onOpenUrl,
  baseDir = null,
  workOpen,
  selectedWorkerId: controlledWorkerId,
  onSelectedWorkerChange,
  onApprove,
  onReject,
  approvalBusy = null,
  question,
  onAnswerQuestion,
  answerBusy = false,
  onRecoveryAction,
  onUndoTurn,
  activityCaption = null,
  regenerating = false,
}: {
  turn: ConversationTurnView;
  onEdit?: (turn: ConversationTurnView) => void;
  /** CHAT-6: save an inline user-message edit as a revision. */
  onSaveEdit?: (turn: ConversationTurnView, text: string) => void | Promise<void>;
  /** Re-run this turn's user message as a follow-up (CHAT-1). */
  onRetryTurn?: (turn: ConversationTurnView) => void | Promise<void>;
  onOpenFile?: (path: string) => void;
  onOpenDeliverables?: () => void;
  onOpenUrl?: (url: string) => void;
  baseDir?: string | null;
  workOpen?: boolean;
  selectedWorkerId?: string | null;
  onSelectedWorkerChange?: (workerId: string | null) => void;
  onApprove?: (target: ApprovalActionTarget) => void | Promise<void>;
  onReject?: (target: ApprovalActionTarget) => void | Promise<void>;
  approvalBusy?: "approve" | "reject" | null;
  question?: TurnQuestion | null;
  onAnswerQuestion?: (label: string) => void;
  answerBusy?: boolean;
  onRecoveryAction?: (action: RecoveryAction, turnId: string) => void;
  /** Capability-gated undo-last-turn (ACP rewind). Hidden when undefined. */
  onUndoTurn?: (turn: ConversationTurnView) => void | Promise<void>;
  /** PROG-3: latest run_progress / liveSummary for the active turn. */
  activityCaption?: string | null;
  /** CHAT-6: freeze the user bubble while a revision is regenerating. */
  regenerating?: boolean;
}) {
  const t = useT();
  const [internalWorkerId, setInternalWorkerId] = useState<string | null>(null);
  const selectedWorkerId =
    controlledWorkerId !== undefined ? controlledWorkerId : internalWorkerId;
  const workers = useMemo(() => workerListForTurn(turn.workers), [turn.workers]);
  const showLiveWork =
    LIVE_STATES.has(turn.state) &&
    !(turn.state === "waiting_approval" && turn.approval);
  const planOwnsApproval =
    turn.plan?.status === "awaiting_approval" &&
    (turn.approval?.payload.kind === "plan_review" ||
      turn.approval?.payload.planReview === true);
  const foldedArtifacts = useMemo(
    () =>
      foldTurnArtifacts(
        turn.artifacts.map((a, i) => ({
          id: a.id,
          title: a.title,
          path: a.path,
          // Durable artifacts lack stream seq; preserve list order as seq.
          seq: i,
        })),
        { live: showLiveWork },
      ),
    [turn.artifacts, showLiveWork],
  );
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [restoreApprovalFocus, setRestoreApprovalFocus] =
    useState<ApprovalDecision | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [answerCopied, setAnswerCopied] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const turnRef = useRef<HTMLElement | null>(null);
  const answerStartRef = useRef<HTMLDivElement | null>(null);
  const longAnswer = isLongAnswer(turn.answer?.text);
  const approveRef = useRef<HTMLButtonElement | null>(null);
  const rejectRef = useRef<HTMLButtonElement | null>(null);
  const approvalTarget = approvalTargetForTurn(turn);
  const actionableApproval =
    turn.state === "waiting_approval" && Boolean(approvalTarget);
  const recovery =
    turn.state === "failed" && turn.error
      ? recoveryFromErrorMessage(turn.error.message, t)
      : null;
  const canRetry =
    Boolean(onRetryTurn) &&
    !turn.superseded &&
    TERMINAL_TURN_STATES.has(turn.state);
  const answerMarkdown = turn.answer?.text?.trim() ?? "";
  const showAssistantActions = Boolean(answerMarkdown) || canRetry;
  const isEditing = editDraft !== null;
  const canStartEdit =
    Boolean(onSaveEdit || onEdit) && !turn.superseded && !regenerating;

  useEffect(() => {
    if (approvalBusy !== null || restoreApprovalFocus === null) return;
    const element =
      restoreApprovalFocus === "approve" ? approveRef.current : rejectRef.current;
    const schedule = (callback: () => void) => {
      if (typeof requestAnimationFrame === "function")
        requestAnimationFrame(callback);
      else queueMicrotask(callback);
    };
    restoreApprovalActionFocus(element, schedule);
    setRestoreApprovalFocus(null);
  }, [approvalBusy, restoreApprovalFocus]);

  useEffect(() => {
    if (!isEditing) return;
    const el = editInputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isEditing]);

  const cancelEdit = () => {
    setEditDraft(null);
    setSaveBusy(false);
  };

  const commitEdit = () => {
    if (editDraft === null || saveBusy) return;
    const next = editDraft.trim();
    if (!next) return;
    if (onSaveEdit) {
      setSaveBusy(true);
      void Promise.resolve(onSaveEdit(turn, next)).finally(() => {
        setSaveBusy(false);
        setEditDraft(null);
      });
      return;
    }
    onEdit?.(turn);
    setEditDraft(null);
  };

  const article = (
    <article
      ref={turnRef}
      tabIndex={-1}
      className="mx-auto w-full max-w-[46rem] space-y-3"
      data-conversation-turn
      data-turn-id={turn.id}
      data-task-id={turn.taskId}
      data-regenerating={regenerating ? "true" : undefined}
    >
      <div className="flex justify-end">
        <div
          className={cn(
            "max-w-[85%] rounded-2xl rounded-br-md bg-muted/65 px-3.5 py-2.5 text-sm leading-relaxed text-foreground",
            regenerating && "opacity-80",
          )}
        >
          {isEditing ? (
            <div className="space-y-2" data-edit-message>
              <textarea
                ref={editInputRef}
                data-edit-input
                className="w-full min-h-[4.5rem] resize-y rounded-md border border-border/70 bg-[hsl(var(--surface-3))] px-2.5 py-2 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={editDraft ?? ""}
                aria-label={t("conversation.editingMessage")}
                disabled={saveBusy}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEdit();
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    commitEdit();
                  }
                }}
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  data-cancel-edit
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50"
                  disabled={saveBusy}
                  onClick={cancelEdit}
                >
                  {t("turn.cancelEdit")}
                  <kbd className="rounded border border-border/60 px-1 font-mono text-2xs opacity-70">
                    {t("turn.kbdEsc")}
                  </kbd>
                </button>
                <button
                  type="button"
                  data-save-edit
                  className="inline-flex items-center gap-1 rounded-md bg-primary/90 px-2 py-1 text-2xs font-medium text-primary-foreground transition-colors hover:bg-primary disabled:opacity-50"
                  disabled={saveBusy || !(editDraft ?? "").trim()}
                  onClick={commitEdit}
                >
                  {saveBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : null}
                  {t("turn.saveEdit")}
                  <kbd className="rounded border border-primary-foreground/25 px-1 font-mono text-2xs opacity-80">
                    {t("turn.kbdEnter")}
                  </kbd>
                </button>
              </div>
            </div>
          ) : (
            <>
              <UserGoalBubbleText text={turn.userMessage} />
              {regenerating ? (
                <p
                  className="mt-1.5 text-2xs font-medium text-muted-foreground"
                  data-regenerating-label
                  role="status"
                >
                  {t("conversation.submittingMessage")}
                </p>
              ) : null}
              {turn.fullPrompt ? (
                <Collapsible className="mt-1.5">
                  <CollapsibleTrigger className="group inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 transition-transform motion-reduce:transition-none",
                        "group-data-[state=open]:rotate-90",
                      )}
                      aria-hidden="true"
                    />
                    {t("workspace.viewFullPrompt")}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-1.5">
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-white/[0.06] bg-[hsl(var(--surface-3))] p-2 font-mono text-2xs leading-relaxed text-muted-foreground">
                      {turn.fullPrompt}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
              <div className="mt-1 flex items-center justify-end gap-2 text-2xs text-muted-foreground">
                {turn.superseded ? <span>{t("conversation.edited")}</span> : null}
                {canStartEdit ? (
                  <button
                    type="button"
                    data-edit-turn
                    className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                    onClick={() => {
                      if (onSaveEdit) {
                        setEditDraft(turn.userMessage);
                        return;
                      }
                      onEdit?.(turn);
                    }}
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    {t("conversation.edit")}
                  </button>
                ) : null}
                {onUndoTurn && !turn.superseded && !showLiveWork && !isEditing ? (
                  <button
                    type="button"
                    data-undo-turn
                    className="inline-flex items-center gap-1 transition-colors hover:text-foreground disabled:opacity-50"
                    disabled={undoBusy}
                    onClick={() => {
                      setUndoBusy(true);
                      void Promise.resolve(onUndoTurn(turn)).finally(() =>
                        setUndoBusy(false),
                      );
                    }}
                  >
                    {t("conversation.undoTurn")}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {turn.state === "queued" ? (
        <p
          className="text-xs font-medium text-muted-foreground"
          data-queued-status
        >
          {t("conversation.queued")}
        </p>
      ) : null}

      <div
        className={cn(
          "space-y-3",
          (showLiveWork || turn.approval || turn.answer) && "min-h-6",
        )}
        data-turn-response-slot
        data-turn-response-state={
          turn.approval
            ? "approval"
            : showLiveWork
              ? "working"
              : turn.answer
                ? "answer"
                : "idle"
        }
      >

      {showLiveWork ? (
        <LiveWorkCard
          run={turn.primaryRun}
          workers={workers}
          work={turn.work}
          activityCaption={turn.liveSummary ?? activityCaption}
          events={turn.work.map((w) => ({
            kind: w.kind,
            payload: w.payload,
            createdAt: w.timestamp,
          }))}
        />
      ) : null}

      {workers.length > 0 ? (
        <WorkerStrip
          workers={workers}
          selectedWorkerId={selectedWorkerId}
          onSelect={(workerId) => {
            applyWorkerSelection({
              controlled: controlledWorkerId !== undefined,
              workerId,
              setInternal: setInternalWorkerId,
              onChange: onSelectedWorkerChange,
            });
          }}
        />
      ) : null}

      {turn.approval && !planOwnsApproval ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-sm transition-colors duration-200",
            approvalBusy === "approve" &&
              "border-success/40 bg-success/[0.1]",
            approvalBusy === "reject" &&
              "border-destructive/40 bg-destructive/[0.08]",
            approvalBusy === null &&
              "border-warning/35 bg-warning/[0.08]",
          )}
          role="region"
          aria-label={t("conversation.waitingApproval")}
          data-approval-actions
          data-task-id={turn.taskId}
          data-approval-id={turn.approval.approvalId}
          data-approval-busy={approvalBusy ?? undefined}
          aria-busy={approvalBusy !== null}
        >
          <p
            className={cn(
              "font-medium",
              approvalBusy === "approve" && "text-success",
              approvalBusy === "reject" &&
                "text-destructive-text",
              approvalBusy === null && "text-warning",
            )}
          >
            {approvalBusy === "approve"
              ? t("workspace.approving")
              : approvalBusy === "reject"
                ? t("workspace.rejecting")
                : t("conversation.waitingApproval")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {turn.approval.summary}
          </p>
          {onApprove && onReject && approvalTarget && actionableApproval ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                ref={approveRef}
                type="button"
                size="sm"
                disabled={approvalBusy !== null}
                className={
                  approvalBusy === "approve"
                    ? "border-success/40 bg-success/20 text-success hover:bg-success/25"
                    : undefined
                }
                data-approve-action
                data-approval-focus-target
                data-task-id={approvalTarget.taskId}
                data-approval-id={approvalTarget.approvalId}
                onClick={() => {
                  setApprovalError("");
                  void runApprovalAction({
                    target: approvalTarget,
                    action: onApprove,
                    actionElement: approveRef.current,
                    turnElement: turnRef.current,
                    announce: setApprovalError,
                  }).then((ok) => {
                    if (!ok) setRestoreApprovalFocus("approve");
                  });
                }}
              >
                {approvalBusy === "approve" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                {approvalBusy === "approve"
                  ? t("workspace.approving")
                  : t("workspace.approve")}
              </Button>
              <Button
                ref={rejectRef}
                type="button"
                size="sm"
                variant="ghost"
                disabled={approvalBusy !== null}
                className={
                  approvalBusy === "reject"
                    ? "text-destructive-text"
                    : undefined
                }
                data-reject-action
                data-task-id={approvalTarget.taskId}
                data-approval-id={approvalTarget.approvalId}
                onClick={() => {
                  setApprovalError("");
                  void runApprovalAction({
                    target: approvalTarget,
                    action: onReject,
                    actionElement: rejectRef.current,
                    turnElement: turnRef.current,
                    announce: setApprovalError,
                  }).then((ok) => {
                    if (!ok) setRestoreApprovalFocus("reject");
                  });
                }}
              >
                {approvalBusy === "reject" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                {approvalBusy === "reject"
                  ? t("workspace.rejecting")
                  : t("workspace.reject")}
              </Button>
            </div>
          ) : null}
          <p className="sr-only" aria-live="assertive">
            {approvalError}
          </p>
        </div>
      ) : null}

      {turn.plan ? (
        <PlanCard
          plan={turn.plan}
          busy={Boolean(approvalBusy)}
          actionable={planOwnsApproval}
          onOpenUrl={onOpenUrl}
          onApprove={() => {
            if (!approvalTarget || !onApprove) return;
            void runApprovalAction({
              target: approvalTarget,
              action: onApprove,
              actionElement: null,
              turnElement: turnRef.current,
              announce: setApprovalError,
            });
          }}
          onRequestChanges={() => {
            if (!approvalTarget || !onReject) return;
            void runApprovalAction({
              target: approvalTarget,
              action: onReject,
              actionElement: null,
              turnElement: turnRef.current,
              announce: setApprovalError,
            });
          }}
          onRunAnyway={() => {
            if (!approvalTarget || !onApprove) return;
            void runApprovalAction({
              target: approvalTarget,
              action: onApprove,
              actionElement: null,
              turnElement: turnRef.current,
              announce: setApprovalError,
            });
          }}
        />
      ) : null}

      {turn.answer || showAssistantActions ? (
        <div
          className="group/assistant relative"
          {...(turn.answer ? { "data-assistant-answer": true } : {})}
        >
          {turn.answer ? (
            <div ref={answerStartRef} data-answer-start>
              <Markdown className="max-w-none text-foreground" onOpenUrl={onOpenUrl}>
                {turn.answer.text}
              </Markdown>
            </div>
          ) : null}
          {longAnswer ? (
            <button
              type="button"
              data-testid="back-to-answer-start"
              className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={t("workspace.backToAnswerStart")}
              onClick={() => {
                answerStartRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            >
              <ArrowUp className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
              {t("workspace.backToAnswerStart")}
            </button>
          ) : null}
          {showAssistantActions ? (
            <div
              className={cn(
                "mt-1.5 flex flex-wrap items-center gap-1",
                "opacity-0 transition-opacity",
                "group-hover/assistant:opacity-100 group-focus-within/assistant:opacity-100",
              )}
              data-assistant-actions
            >
              {answerMarkdown ? (
                <button
                  type="button"
                  data-copy-answer
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={t("turn.copy")}
                  onClick={() => {
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(answerMarkdown);
                        setAnswerCopied(true);
                        window.setTimeout(() => setAnswerCopied(false), 1400);
                      } catch {
                        // clipboard blocked; no-op
                      }
                    })();
                  }}
                >
                  {answerCopied ? (
                    <>
                      <Check className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                      {t("turn.copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                      {t("turn.copy")}
                    </>
                  )}
                </button>
              ) : null}
              {canRetry ? (
                <button
                  type="button"
                  data-retry-turn
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  aria-label={t("turn.retry")}
                  disabled={retryBusy}
                  onClick={() => {
                    if (!onRetryTurn) return;
                    setRetryBusy(true);
                    void Promise.resolve(onRetryTurn(turn)).finally(() =>
                      setRetryBusy(false),
                    );
                  }}
                >
                  <RotateCcw className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                  {t("turn.retry")}
                </button>
              ) : null}
            </div>
          ) : null}
          {turn.answer && turn.citations.length > 0 ? (
            <CitationCards items={turn.citations} onOpenUrl={onOpenUrl} />
          ) : null}
        </div>
      ) : null}
      </div>

      {foldedArtifacts.kind === "digest" ? (
        <div data-turn-artifacts data-turn-artifacts-digest>
          <DeliverablesDigestCard
            media={foldedArtifacts.media}
            moreCount={foldedArtifacts.moreCount}
            onOpenFile={onOpenFile}
            onOpenDeliverables={onOpenDeliverables}
            baseDir={baseDir}
          />
        </div>
      ) : foldedArtifacts.items.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-turn-artifacts>
          {foldedArtifacts.items.map((artifact) => {
            const mediaPath =
              artifact.path &&
              (isImagePath(artifact.path) ||
                isVideoPath(artifact.path) ||
                isAudioPath(artifact.path))
                ? artifact.path
                : null;
            if (mediaPath) {
              return (
                <div key={artifact.id} className="w-full min-w-0">
                  <ArtifactMedia
                    path={mediaPath}
                    title={artifact.title}
                    onOpenFile={onOpenFile}
                    baseDir={baseDir}
                  />
                </div>
              );
            }
            const content = (
              <>
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{artifact.title}</span>
              </>
            );
            return artifact.path && onOpenFile ? (
              <button
                key={artifact.id}
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-foreground/90 transition-colors hover:bg-muted/50"
                onClick={() => onOpenFile(artifact.path!)}
              >
                {content}
              </button>
            ) : (
              <span
                key={artifact.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-foreground/90"
              >
                {content}
              </span>
            );
          })}
        </div>
      ) : null}

      {recovery && !recoveryDismissed ? (
        <div
          data-turn-recovery
          data-recovery-task-id={turn.taskId}
          role="alert"
        >
          <RecoveryBanner
            model={recovery}
            onAction={(action) => {
              if (action === "dismiss") setRecoveryDismissed(true);
              onRecoveryAction?.(action, turn.taskId);
            }}
          />
        </div>
      ) : null}

      {question && onAnswerQuestion ? (
        <div className="space-y-2" data-turn-question>
          <p className="text-sm font-medium leading-snug text-foreground/90">
            {question.prompt || t("workspace.questionPick")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {question.options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={answerBusy}
                className="rounded-full border border-border/70 px-3 py-1.5 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                onClick={() => onAnswerQuestion(option.label)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <WorkDetails
        entries={turn.work}
        selectedWorkerId={selectedWorkerId}
        open={workOpen}
        onOpenFile={onOpenFile}
      />
    </article>
  );

  if (!turn.superseded) return article;

  return (
    <details
      className="mx-auto w-full max-w-[46rem] rounded-xl border border-border/50 bg-muted/20 px-3 py-2"
      data-superseded-turn
    >
      <summary className="cursor-pointer text-xs text-muted-foreground">
        <span className="ml-1 font-medium">{t("conversation.edited")}</span>
        <span className="ml-2 line-clamp-1 opacity-80">{turn.userMessage}</span>
      </summary>
      <div className="mt-3">{article}</div>
    </details>
  );
}
