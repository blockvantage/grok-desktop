import { useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Inbox,
  KeyRound,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { EffortLevel, InboxItem, InboxKind } from "@grokdesk/shared";
import { rpc } from "@/lib/api";
import {
  buildScheduleCreateFromDraft,
  parseSuggestionDraftSchedule,
} from "@/lib/inbox-actions";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function InboxPanel(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: InboxItem[];
  workspaceRoots: string[];
  model?: string;
  effort?: EffortLevel;
  approvalMode?: "strict" | "balanced" | "autopilot";
  onDismiss: (id: string) => Promise<void> | void;
  onMarkRead: (id: string) => Promise<void> | void;
  onOpenTask: (taskId: string) => void;
  onOpenSettings: () => void;
  onScheduleCreated?: () => void;
  onRefreshSide?: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const sorted = [...props.items].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  async function createSchedule(item: InboxItem) {
    const draft = parseSuggestionDraftSchedule(item.body);
    if (!draft) {
      toast({
        description: t("inbox.parseFailed"),
        variant: "destructive",
      });
      return;
    }
    const roots = props.workspaceRoots.map((r) => r.trim()).filter(Boolean);
    if (roots.length === 0) {
      toast({
        description: t("inbox.needWorkspace"),
        variant: "destructive",
      });
      return;
    }
    setBusyId(item.id);
    try {
      const params = buildScheduleCreateFromDraft(draft, {
        workspaceRoots: roots,
        model: props.model,
        effort: props.effort,
        approvalMode: props.approvalMode,
      });
      await rpc("schedule.create", params);
      await props.onDismiss(item.id);
      toast({
        description: t("inbox.scheduleCreated"),
        variant: "success",
      });
      props.onRefreshSide?.();
      props.onScheduleCreated?.();
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismiss(item: InboxItem) {
    setBusyId(item.id);
    try {
      await props.onDismiss(item.id);
    } finally {
      setBusyId(null);
    }
  }

  async function handleOpenTask(item: InboxItem) {
    if (!item.read) void props.onMarkRead(item.id);
    if (item.taskId && !item.taskId.startsWith("suggestion:")) {
      props.onOpenTask(item.taskId);
      props.onOpenChange(false);
    }
  }

  async function handleReauth() {
    props.onOpenSettings();
    props.onOpenChange(false);
  }

  async function handleMarkRead(item: InboxItem) {
    if (item.read) return;
    setBusyId(item.id);
    try {
      await props.onMarkRead(item.id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-white/10 bg-background p-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-1 border-b border-white/[0.06] px-5 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-md">
            <Inbox className="h-4 w-4 text-primary" strokeWidth={1.75} />
            {t("inbox.title")}
          </SheetTitle>
          <SheetDescription className="text-sm">
            {t("inbox.subtitle")}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-2 p-3">
            {sorted.length === 0 && (
              <EmptyState
                icon={
                  <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
                }
                title={t("inbox.emptyTitle")}
                description={t("inbox.emptyDesc")}
                className="py-12"
              />
            )}
            {sorted.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onCreateSchedule={() => void createSchedule(item)}
                onDismiss={() => void handleDismiss(item)}
                onOpenTask={() => void handleOpenTask(item)}
                onReauth={() => void handleReauth()}
                onMarkRead={() => void handleMarkRead(item)}
              />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function InboxRow({
  item,
  busy,
  onCreateSchedule,
  onDismiss,
  onOpenTask,
  onReauth,
  onMarkRead,
}: {
  item: InboxItem;
  busy: boolean;
  onCreateSchedule: () => void;
  onDismiss: () => void;
  onOpenTask: () => void;
  onReauth: () => void;
  onMarkRead: () => void;
}) {
  const t = useT();
  const kind = item.kind;
  const canOpenTask =
    Boolean(item.taskId) &&
    !item.taskId!.startsWith("suggestion:") &&
    (kind === "approval" ||
      kind === "unfinished" ||
      kind === "clarification" ||
      kind === "schedule_done");

  const needsYou =
    kind === "approval" || kind === "clarification" || kind === "unfinished";
  return (
    <article
      className={cn(
        "rounded-xl border px-3.5 py-3 transition-colors",
        item.read
          ? "border-white/[0.04] bg-white/[0.02]"
          : needsYou
            ? "border-warning/30 bg-warning/[0.08]"
            : "border-primary/20 bg-primary/[0.06]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 shrink-0",
            !item.read && needsYou
              ? "text-warning"
              : "text-muted-foreground",
          )}
        >
          <KindIcon kind={kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="secondary"
              className={cn(
                "h-5 px-1.5 text-2xs",
                !item.read && needsYou && "bg-warning/15 text-warning",
              )}
            >
              {t(`inbox.kind.${kind}`)}
            </Badge>
            {!item.read && (
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  needsYou ? "bg-warning" : "bg-primary",
                )}
              />
            )}
            <span className="ml-auto text-2xs text-muted-foreground">
              {relativeTime(item.createdAt)}
            </span>
          </div>
          <h3 className="mt-1.5 text-sm font-medium leading-snug">
            {item.title}
          </h3>
          {item.body?.trim() && (
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/85">
              {item.body}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {kind === "suggestion" && (
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                disabled={busy}
                onClick={onCreateSchedule}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                {t("inbox.createSchedule")}
              </Button>
            )}
            {canOpenTask && (
              <Button
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={busy}
                onClick={onOpenTask}
              >
                {t("inbox.openTask")}
              </Button>
            )}
            {kind === "reauth" && (
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={onReauth}
              >
                <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("inbox.openSettings")}
              </Button>
            )}
            {!item.read && kind !== "suggestion" && !canOpenTask && kind !== "reauth" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                disabled={busy}
                onClick={onMarkRead}
              >
                {t("inbox.markRead")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              disabled={busy}
              onClick={onDismiss}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("inbox.dismiss")}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function KindIcon({ kind }: { kind: InboxKind }) {
  const cls = "h-4 w-4";
  switch (kind) {
    case "suggestion":
      return <Sparkles className={cls} strokeWidth={1.75} />;
    case "approval":
    case "clarification":
      return <AlertCircle className={cls} strokeWidth={1.75} />;
    case "reauth":
      return <KeyRound className={cls} strokeWidth={1.75} />;
    case "schedule_done":
      return <CalendarClock className={cls} strokeWidth={1.75} />;
    default:
      return <Inbox className={cls} strokeWidth={1.75} />;
  }
}
