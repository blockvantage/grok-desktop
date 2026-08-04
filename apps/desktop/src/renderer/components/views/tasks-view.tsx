import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/status-pill";
import { EmptyState } from "@/components/empty-state";
import { relativeTime } from "@/lib/format";
import {
  isListRowActivateKey,
  taskListDensity,
  taskListGridClass,
  taskListShowsActivity,
  taskListShowsModel,
  type TaskListDensity,
} from "@/lib/list-layout";
import { cn } from "@/lib/utils";
import { buildChats, type Chat } from "@/lib/chats";
import {
  isActiveTaskStatus,
  type Artifact,
  type Task,
} from "@grokdesk/shared";
import { useT } from "@/i18n";
import { CONVERSATION_I18N } from "@/lib/conversation-noun";

type FilterKey = "all" | "running" | "scheduled" | "done" | "failed";

export function TasksView(props: {
  tasks: Task[];
  artifacts: Artifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenWorkspace: (id: string) => void;
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  /** Topbar-owned query (Phase 2: no view-local search field). */
  search: string;
  onCancel: (id: string) => void;
  /** Jump to Home compose when the list is empty. */
  onNewTask?: () => void;
}) {
  const t = useT();
  const [density, setDensity] = useState<TaskListDensity>(() =>
    typeof window !== "undefined"
      ? taskListDensity(window.innerWidth)
      : "full",
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const onResize = () => setDensity(taskListDensity(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const grid = taskListGridClass(density);
  const showModel = taskListShowsModel(density);
  const showActivity = taskListShowsActivity(density);

  const chats = useMemo(() => buildChats(props.tasks), [props.tasks]);

  const chatMatchesFilter = (chat: Chat): boolean => {
    if (props.filter === "all") return true;
    if (props.filter === "running") {
      return chat.turns.some((turn) => isActiveTaskStatus(turn.status));
    }
    if (props.filter === "scheduled") {
      return chat.turns.some((turn) => turn.mode === "scheduled");
    }
    if (props.filter === "done") {
      return chat.latest.status === "done";
    }
    if (props.filter === "failed") {
      // Needs-review: failed or cancelled latest outcome.
      return (
        chat.latest.status === "failed" || chat.latest.status === "cancelled"
      );
    }
    return true;
  };

  const chatMatchesSearch = (chat: Chat): boolean => {
    const q = props.search.trim().toLowerCase();
    if (!q) return true;
    if (chat.title.toLowerCase().includes(q)) return true;
    return chat.turns.some(
      (turn) =>
        turn.goal.toLowerCase().includes(q) ||
        (turn.title ?? "").toLowerCase().includes(q),
    );
  };

  const filtered = chats.filter(
    (c) => chatMatchesFilter(c) && chatMatchesSearch(c),
  );

  const counts = {
    all: chats.length,
    running: chats.filter((c) =>
      c.turns.some((turn) => isActiveTaskStatus(turn.status)),
    ).length,
    scheduled: chats.filter((c) =>
      c.turns.some((turn) => turn.mode === "scheduled"),
    ).length,
    done: chats.filter((c) => c.latest.status === "done").length,
    failed: chats.filter(
      (c) =>
        c.latest.status === "failed" || c.latest.status === "cancelled",
    ).length,
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border/70 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-display">
                {t("conversation.listTitle")}
                <ListChecks className="h-5 w-5 text-primary" strokeWidth={1.75} />
              </h1>
              <p className="mt-1.5 text-base text-muted-foreground/90">
                {t("tasks.subtitle")}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ["all", t("tasks.all"), counts.all],
                ["running", t("tasks.running"), counts.running],
                ["scheduled", t("tasks.scheduled"), counts.scheduled],
                ["done", t("tasks.done"), counts.done],
                ["failed", t("tasks.failed"), counts.failed],
              ] as const
            ).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                onClick={() => props.onFilter(key)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all duration-150",
                  props.filter === key
                    ? "border-white/[0.1] bg-white/[0.08] text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                    : "border-white/[0.06] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground/90",
                )}
              >
                {label}
                <Badge
                  variant="secondary"
                  className="h-5 min-w-5 justify-center rounded-full px-1.5 text-2xs"
                >
                  {n}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-4 py-2 sm:px-6">
            <div
              className={cn(
                "sticky top-0 z-[1] grid gap-2 border-b border-border/50 bg-background/90 px-2 py-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur-md",
                grid,
              )}
            >
              <span>{t(CONVERSATION_I18N.unit)}</span>
              <span>{t("tasks.colStatus")}</span>
              {showModel && <span>{t("tasks.colModel")}</span>}
              {showActivity && <span>{t("tasks.colLastActivity")}</span>}
              <span />
            </div>
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
                title={
                  chats.length === 0
                    ? t(CONVERSATION_I18N.empty)
                    : t("tasks.emptyFilterTitle")
                }
                description={
                  chats.length === 0
                    ? t("tasks.emptyDesc")
                    : t("tasks.emptyFilterDesc")
                }
                actionLabel={
                  chats.length === 0 && props.onNewTask
                    ? t("tasks.emptyAction")
                    : undefined
                }
                onAction={chats.length === 0 ? props.onNewTask : undefined}
                className="py-12"
              />
            ) : (
              filtered.map((chat) => {
                const open = expanded.has(chat.id) && chat.turns.length > 1;
                const active =
                  props.selectedId === chat.latest.id ||
                  chat.turns.some((turn) => turn.id === props.selectedId);
                const multi = chat.turns.length > 1;
                return (
                  <div key={chat.id} className="border-b border-white/[0.03]">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => props.onOpenWorkspace(chat.latest.id)}
                      onKeyDown={(e) => {
                        if (isListRowActivateKey(e.key)) {
                          e.preventDefault();
                          props.onOpenWorkspace(chat.latest.id);
                        }
                      }}
                      className={cn(
                        "group grid cursor-pointer items-center gap-2 rounded-xl border border-transparent px-2 py-3 transition-all duration-150 ease-premium hover:-translate-y-px hover:bg-muted/25 hover:shadow-[0_8px_24px_-16px_rgba(0,0,0,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        grid,
                        active && "border-border/60 bg-muted/30",
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        {multi ? (
                          <button
                            type="button"
                            className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                            aria-label={
                              open
                                ? t("tasks.collapseRuns")
                                : t("tasks.expandRuns")
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(chat.id);
                            }}
                          >
                            {open ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        ) : (
                          <span className="mt-1.5 w-6 shrink-0" />
                        )}
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-muted-foreground">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {chat.title}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {multi
                              ? t("nav.runsCount", { count: chat.turns.length })
                              : chat.latest.goal}
                          </div>
                        </div>
                      </div>
                      <StatusPill status={chat.latest.status} />
                      {showModel && (
                        <span className="truncate text-xs text-muted-foreground">
                          {chat.latest.model}
                        </span>
                      )}
                      {showActivity && (
                        <span className="text-xs text-muted-foreground">
                          {relativeTime(chat.updatedAt)}
                        </span>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={t("tasks.rowMenu")}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              props.onOpenWorkspace(chat.latest.id)
                            }
                          >
                            {t("tasks.openWorkspace")}
                          </DropdownMenuItem>
                          {isActiveTaskStatus(chat.latest.status) && (
                            <DropdownMenuItem
                              className="text-destructive-text"
                              onClick={() => props.onCancel(chat.latest.id)}
                            >
                              {t("common.cancel")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {open &&
                      chat.turns.map((turn, idx) => (
                        <div
                          key={turn.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => props.onOpenWorkspace(turn.id)}
                          onKeyDown={(e) => {
                            if (isListRowActivateKey(e.key)) {
                              e.preventDefault();
                              props.onOpenWorkspace(turn.id);
                            }
                          }}
                          className={cn(
                            "ml-10 grid cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-sm transition-colors hover:bg-muted/20",
                            grid,
                            props.selectedId === turn.id &&
                              "border-border/50 bg-muted/20",
                          )}
                        >
                          <div className="min-w-0 truncate pl-2 text-muted-foreground">
                            <span className="mr-2 font-mono text-2xs text-muted-foreground">
                              {idx + 1}
                            </span>
                            {turn.goal}
                          </div>
                          <StatusPill status={turn.status} />
                          {showModel && (
                            <span className="truncate text-xs text-muted-foreground">
                              {turn.model}
                            </span>
                          )}
                          {showActivity && (
                            <span className="text-xs text-muted-foreground">
                              {relativeTime(turn.updatedAt)}
                            </span>
                          )}
                          <span />
                        </div>
                      ))}
                  </div>
                );
              })
            )}
            {filtered.length > 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                {t("tasks.showing", {
                  n: filtered.length,
                  total: chats.length,
                })}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
