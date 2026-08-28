import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  Boxes,
  CalendarClock,
  ChevronDown,
  Folder,
  GripVertical,
  Home,
  Inbox,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Pin,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { getActiveIntlLocale } from "@/i18n/active";
import { statusDotClass } from "@/lib/status-styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/brand-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus as PlusIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  PanelLeftClose as PanelLeftCloseIcon,
  PanelLeftOpen as PanelLeftOpenIcon,
  LogIn as LogInIcon,
  LogOut as LogOutIcon,
  RefreshCw as RefreshCwIcon,
  Trash2 as Trash2Icon,
} from "lucide-react";
import {
  isActiveTaskStatus,
  type AuthState,
  type UsageSnapshot,
} from "@grokdesk/shared";
import type { Chat } from "@/lib/chats";
import { isManagedWorkspacePath } from "@/lib/managed-workspace";
import {
  FOLDER_ORDER_STORAGE_KEY as FOLDER_ORDER_KEY,
  capFolderOrder,
  parseFolderOrderRaw,
} from "@/lib/folder-order";
import { partitionSidebarChats } from "@/lib/sidebar-chat-sections";
import {
  rosterActivityLabelKey,
  rosterRowView,
} from "@/lib/roster-row";
import { useT } from "@/i18n";
import { SupportContributeMenu } from "@/components/shell/support-contribute-menu";

export type NavId =
  | "home"
  | "tasks"
  | "scheduled"
  | "artifacts"
  | "memory"
  | "settings";

const NAV_ICONS: Record<NavId, React.ReactNode> = {
  home: <Home className="h-4 w-4" strokeWidth={1.75} />,
  tasks: <ListChecks className="h-4 w-4" strokeWidth={1.75} />,
  scheduled: <CalendarClock className="h-4 w-4" strokeWidth={1.75} />,
  artifacts: <Boxes className="h-4 w-4" strokeWidth={1.75} />,
  memory: <BookMarked className="h-4 w-4" strokeWidth={1.75} />,
  settings: <SettingsIcon size={16} strokeWidth={1.75} />,
};

const NAV_IDS: NavId[] = [
  "home",
  "tasks",
  "scheduled",
  "artifacts",
  "memory",
  "settings",
];

export function AppSidebar(props: {
  nav: NavId;
  onNav: (id: NavId) => void;
  chats: Chat[];
  selectedChatId: string | null;
  onOpenChat: (latestTurnId: string) => void;
  onRenameChat: (rootId: string, title: string) => void;
  onResetChatTitle?: (rootId: string) => void;
  onDeleteChat: (rootId: string) => void;
  onTogglePinChat?: (rootId: string) => void;
  pinnedChatIds?: string[];
  onNewTask: () => void;
  auth: (AuthState & { models?: string[] }) | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefreshAuth: () => void;
  onCancelTask?: (id: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Waiting-on-you count; shows badge near Home / mail control. */
  inboxUnread?: number;
  /** Task ids currently waiting on the user (projector). */
  needsInputTaskIds?: readonly string[];
  onOpenInbox?: () => void;
  /** Shared SuperGrok usage snapshot (same source as Home/Settings). */
  usage?: UsageSnapshot | null;
  /** Connection attention (reauth / error) for status dot. */
  accountAttention?: boolean;
  onOpenAccount?: () => void;
  /**
   * When false, hide the Sign-in CTA (e.g. account status still checking).
   * Defaults true when signed out so existing callers keep inviting.
   */
  showSignInInvite?: boolean;
}) {
  const t = useT();
  const collapsed = Boolean(props.collapsed);
  const displayName =
    props.auth?.accountName ||
    props.auth?.accountLabel ||
    t("topbar.superGrok");
  const initials = displayName.replace(/[^a-zA-Z]/g, "").slice(0, 1).toUpperCase() || "G";
  const usagePct =
    props.usage?.rawAvailable && props.usage.creditUsagePercent != null
      ? Math.round(props.usage.creditUsagePercent)
      : null;
  const resetLabel = props.usage?.billingPeriodEnd
    ? formatResetDate(props.usage.billingPeriodEnd)
    : null;
  const connectedLabel = props.accountAttention
    ? t("account.needsAttention")
    : t("account.connected");

  const navItems = useMemo(
    () =>
      NAV_IDS.map((id) => ({
        id,
        label: t(`nav.${id}`),
        icon: NAV_ICONS[id],
      })),
    [t],
  );

  // Chat filter is owned by topbar/palette (SH-5); keep empty for full list.
  const query = "";
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Chat | null>(null);
  const [needsReviewOpen, setNeedsReviewOpen] = useState(false);

  // Persisted folder order (folder keys, most-recent semantics overridden by
  // whatever the user dragged into place). Loaded once, saved on every reorder.
  const [order, setOrder] = useState<string[]>(() => loadOrder());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  // Daily rail: active/recent primary; failed/cancelled under Needs review;
  // retry duplicates collapsed. Full history remains via See all → Chats.
  const { primary: primaryChats, needsReview: needsReviewChats } = useMemo(() => {
    const pinned = new Set(props.pinnedChatIds ?? []);
    const needsInput = new Set(props.needsInputTaskIds ?? []);
    return partitionSidebarChats(
      props.chats.map((c) => ({
        ...c,
        title: c.title,
        pinned: pinned.has(c.id),
        needsInput:
          needsInput.has(c.latest.id) ||
          c.turns.some((turn) => needsInput.has(turn.id)),
      })),
    );
  }, [props.chats, props.pinnedChatIds, props.needsInputTaskIds]);

  const folders = useMemo(
    () => orderFolders(groupChats(primaryChats, query), order),
    [primaryChats, query, order],
  );

  function persistOrder(next: string[]) {
    setOrder(next);
    saveOrder(next);
  }

  function onFolderDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) {
      setDragKey(null);
      setDropKey(null);
      return;
    }
    const keys = folders.map((f) => f.key);
    const from = keys.indexOf(dragKey);
    const to = keys.indexOf(targetKey);
    if (from !== -1 && to !== -1) {
      keys.splice(to, 0, keys.splice(from, 1)[0]!);
      persistOrder(keys);
    }
    setDragKey(null);
    setDropKey(null);
  }

  return (
    <aside
      className={cn(
        "relative flex shrink-0 flex-col border-r border-white/[0.05] bg-[hsl(var(--sidebar)/0.62)] text-sidebar-foreground backdrop-blur-xl transition-[width] duration-200 ease-premium",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Tonal rail: slightly elevated vs canvas (M3 surface hierarchy) */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.035] via-transparent to-black/20" />

      {/* Draggable strip that clears the inset macOS traffic lights */}
      <div className="titlebar-drag h-8 shrink-0" />

      <div
        className={cn(
          "titlebar-drag relative flex items-center gap-3 pb-2 pt-1",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <BrandMark className="h-9 w-9 shrink-0" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold tracking-tight">
              {t("app.name")}
            </div>
            <div className="text-2xs text-muted-foreground">
              {t("app.tagline")}
            </div>
          </div>
        )}
      </div>

      <div className={cn("relative pb-3 pt-2", collapsed ? "px-2" : "px-3")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                className="h-10 w-full [&_svg]:pointer-events-auto"
                onClick={props.onNewTask}
                aria-label={`${t("nav.newChat")} (⌘N)`}
              >
                <PlusIcon size={16} strokeWidth={2} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>{t("nav.newChat")}</span>
              <kbd className="rounded border border-white/10 bg-white/[0.06] px-1 py-px font-mono text-2xs text-muted-foreground">
                ⌘N
              </kbd>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            className="h-10 w-full justify-between gap-2 px-3 text-sm [&_svg]:pointer-events-auto"
            onClick={props.onNewTask}
          >
            <span className="flex items-center gap-2">
              <PlusIcon size={16} strokeWidth={2} />
              {t("nav.newChat")}
            </span>
            <span className="kbd border-primary-foreground/15 bg-primary-foreground/10 text-primary-foreground/75">
              ⌘N
            </span>
          </Button>
        )}
      </div>

      <nav
        className={cn("relative flex flex-col gap-0.5", collapsed ? "px-2" : "px-2.5")}
        aria-label={t("nav.primary")}
      >
        {navItems.map((item) => {
          const active = props.nav === item.id;
          return (
            <NavButton
              key={item.id}
              collapsed={collapsed}
              label={item.label}
              active={active}
              onClick={() => props.onNav(item.id)}
              badge={null}
            >
              {item.icon}
            </NavButton>
          );
        })}
        {props.onOpenInbox && (
          <NavButton
            collapsed={collapsed}
            label={t("inbox.openInbox")}
            active={false}
            onClick={props.onOpenInbox}
            badge={
              (props.inboxUnread ?? 0) > 0
                ? (props.inboxUnread ?? 0) > 99
                  ? "99+"
                  : String(props.inboxUnread)
                : null
            }
          >
            <Inbox className="h-4 w-4" strokeWidth={1.75} />
          </NavButton>
        )}
      </nav>

      {!collapsed && (
        <>
          <div className="relative mx-3 my-3">
            <Separator className="bg-white/[0.05]" />
          </div>

          {/* SH-5: chat search lives in topbar + palette only */}

          <div className="relative flex items-center justify-between px-4 pb-1.5">
            <span className="text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {t("nav.chats")}
            </span>
            <button
              type="button"
              className="text-2xs font-medium text-primary/90 transition-colors hover:text-primary"
              onClick={() => props.onNav("tasks")}
            >
              {t("nav.seeAll")}
            </button>
          </div>

          <ScrollArea className="mask-fade-y relative flex-1 px-2">
            <div className="flex flex-col gap-2 pb-4">
              {folders.map((group) => (
                <div
                  key={group.key}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-lg",
                    dropKey === group.key && dragKey !== group.key && "folder-drop-target",
                  )}
                  onDragOver={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    setDropKey(group.key);
                  }}
                  onDrop={() => onFolderDrop(group.key)}
                >
                  {/* SH-9: folder chrome only when more than one folder exists */}
                  {folders.length > 1 && (
                  <div
                    draggable
                    onDragStart={() => setDragKey(group.key)}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropKey(null);
                    }}
                    className={cn(
                      "group/fh flex cursor-grab items-center gap-1.5 px-2.5 pb-0.5 pt-1 text-2xs font-medium text-muted-foreground active:cursor-grabbing",
                      dragKey === group.key && "opacity-40",
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <GripVertical
                            className="h-3 w-3 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover/fh:opacity-100"
                            strokeWidth={1.75}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">{t("nav.dragReorder")}</TooltipContent>
                    </Tooltip>
                    <Folder className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">
                      {group.label || t("nav.quickChats")}
                    </span>
                    <span className="ml-auto tabular-nums font-normal">
                      {group.chats.length}
                    </span>
                  </div>
                  )}
                  {group.chats.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      chat={chat}
                      active={chat.id === props.selectedChatId}
                      pinned={Boolean(props.pinnedChatIds?.includes(chat.id))}
                      renaming={renamingId === chat.id}
                      onOpen={() => props.onOpenChat(chat.latest.id)}
                      onStartRename={() => setRenamingId(chat.id)}
                      onCancelRename={() => setRenamingId(null)}
                      onCommitRename={(title) => {
                        setRenamingId(null);
                        if (!title) {
                          props.onResetChatTitle?.(chat.id);
                          return;
                        }
                        if (title !== chat.title) {
                          props.onRenameChat(chat.id, title);
                        }
                      }}
                      onResetTitle={
                        props.onResetChatTitle
                          ? () => props.onResetChatTitle?.(chat.id)
                          : undefined
                      }
                      hasCustomTitle={Boolean(chat.root.title?.trim())}
                      onRequestDelete={() => setPendingDelete(chat)}
                      onTogglePin={
                        props.onTogglePinChat
                          ? () => props.onTogglePinChat?.(chat.id)
                          : undefined
                      }
                      onCancel={props.onCancelTask}
                    />
                  ))}
                </div>
              ))}
              {props.chats.length === 0 && (
                <p className="px-2.5 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                  {t("nav.chatsEmpty")}
                </p>
              )}
              {props.chats.length > 0 &&
                folders.length === 0 &&
                needsReviewChats.length === 0 && (
                <p className="px-2.5 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                  {t("nav.noChatsMatch", { query })}
                </p>
              )}
              {needsReviewChats.length > 0 && (
                <div
                  className="mt-2 flex flex-col gap-0.5"
                  data-testid="sidebar-needs-review"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-left text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground/90"
                    onClick={() => setNeedsReviewOpen((v) => !v)}
                    aria-expanded={needsReviewOpen}
                  >
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 shrink-0 transition-transform",
                        !needsReviewOpen && "-rotate-90",
                      )}
                      strokeWidth={1.75}
                    />
                    <span className="truncate">{t("nav.needsReview")}</span>
                    <span className="ml-auto tabular-nums font-normal">
                      {needsReviewChats.length}
                    </span>
                  </button>
                  {needsReviewOpen &&
                    needsReviewChats.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        chat={chat}
                        active={chat.id === props.selectedChatId}
                        pinned={Boolean(props.pinnedChatIds?.includes(chat.id))}
                        renaming={renamingId === chat.id}
                        onOpen={() => props.onOpenChat(chat.latest.id)}
                        onStartRename={() => setRenamingId(chat.id)}
                        onCancelRename={() => setRenamingId(null)}
                        onCommitRename={(title) => {
                          setRenamingId(null);
                          if (!title) {
                            props.onResetChatTitle?.(chat.id);
                            return;
                          }
                          if (title !== chat.title) {
                            props.onRenameChat(chat.id, title);
                          }
                        }}
                        onResetTitle={
                          props.onResetChatTitle
                            ? () => props.onResetChatTitle?.(chat.id)
                            : undefined
                        }
                        hasCustomTitle={Boolean(chat.root.title?.trim())}
                        onRequestDelete={() => setPendingDelete(chat)}
                        onTogglePin={
                          props.onTogglePinChat
                            ? () => props.onTogglePinChat?.(chat.id)
                            : undefined
                        }
                        onCancel={props.onCancelTask}
                      />
                    ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}

      {collapsed && <div className="relative flex-1" />}

      {/* Collapse toggle — icon-first; label only when expanded */}
      <div className={cn("relative", collapsed ? "px-2 pb-1" : "px-2.5 pb-1")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={props.onToggleCollapse}
              aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
              className={cn(
                "flex h-8 items-center gap-2 rounded-lg text-xs text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground/90 [&_svg]:pointer-events-auto",
                collapsed ? "w-full justify-center" : "w-full px-2.5",
              )}
            >
              {collapsed ? (
                <PanelLeftOpenIcon size={16} strokeWidth={1.75} />
              ) : (
                <>
                  <PanelLeftCloseIcon
                    size={16}
                    strokeWidth={1.75}
                  />
                  <span className="sr-only sm:not-sr-only sm:inline">
                    {t("nav.collapseShort")}
                  </span>
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "top"}>
            {collapsed ? t("nav.expand") : t("nav.collapse")}
          </TooltipContent>
        </Tooltip>
      </div>

      <div
        className={cn(
          "relative flex flex-col gap-1 border-t border-white/[0.05]",
          collapsed ? "p-2" : "p-2.5",
        )}
      >
        <SupportContributeMenu collapsed={collapsed} />
        {props.auth?.signedIn ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                title={
                  collapsed
                    ? [
                        displayName,
                        connectedLabel,
                        usagePct != null
                          ? t("settings.usagePercent", { pct: usagePct })
                          : null,
                        resetLabel
                          ? t("sidebar.usageReset", { when: resetLabel })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined
                }
                className={cn(
                  "h-auto w-full gap-2.5 rounded-xl hover:bg-white/[0.04]",
                  collapsed ? "justify-center px-0 py-2" : "justify-start px-2 py-2",
                )}
              >
                <div className="relative shrink-0">
                  <Avatar className="h-8 w-8 ring-1 ring-white/10">
                    <AvatarFallback className="bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  {collapsed && usagePct != null && (
                    <span
                      className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-ring/40"
                      style={{
                        // Compact usage ring via conic gradient — electric progress
                        background: `conic-gradient(hsl(var(--ring)) ${usagePct}%, transparent 0)`,
                        mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
                        WebkitMask:
                          "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
                      }}
                      aria-hidden
                    />
                  )}
                  {props.accountAttention && (
                    <span
                      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background"
                      aria-hidden
                    />
                  )}
                </div>
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-medium">
                        {displayName}
                      </div>
                      <div className="truncate text-2xs text-muted-foreground">
                        {connectedLabel}
                        {usagePct != null
                          ? ` · ${t("sidebar.usagePercent", { pct: usagePct })}`
                          : ""}
                      </div>
                      {usagePct != null && (
                        <div
                          className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]"
                          role="progressbar"
                          aria-valuenow={usagePct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className={cn(
                              // Electric progress fill; warn/hard override with status tokens
                              "h-full rounded-full bg-ring/85",
                              props.usage?.warnLevel === "hard" && "bg-destructive",
                              props.usage?.warnLevel === "soft" && "bg-warning",
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, usagePct))}%` }}
                          />
                        </div>
                      )}
                      {resetLabel && (
                        <div className="mt-0.5 text-2xs text-muted-foreground">
                          {t("sidebar.usageReset", { when: resetLabel })}
                        </div>
                      )}
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 border-white/10">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {props.auth.accountLabel ?? t("nav.account")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/[0.06]" />
              <DropdownMenuItem
                onClick={() =>
                  props.onOpenAccount
                    ? props.onOpenAccount()
                    : props.onNav("settings")
                }
              >
                <SettingsIcon size={16} />
                {t("nav.settings")}
              </DropdownMenuItem>
              {usagePct != null && (
                <DropdownMenuItem
                  onClick={() =>
                    props.onOpenAccount
                      ? props.onOpenAccount()
                      : props.onNav("settings")
                  }
                >
                  {t("sidebar.usagePercent", { pct: usagePct })}
                  {resetLabel
                    ? ` · ${t("sidebar.usageReset", { when: resetLabel })}`
                    : ""}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={props.onRefreshAuth}>
                <RefreshCwIcon size={16} />
                {t("nav.refresh")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/[0.06]" />
              <DropdownMenuItem onClick={props.onSignOut}>
                <LogOutIcon size={16} />
                {t("nav.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : props.showSignInInvite === false ? (
          // Account still resolving - avoid a false "Sign in" flash when SuperGrok is connected.
          <div
            className={cn(
              "h-9 w-full rounded-xl bg-white/[0.03]",
              collapsed && "mx-auto max-w-9",
            )}
            data-testid="sidebar-account-checking"
            aria-hidden
          />
        ) : collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-full [&_svg]:pointer-events-auto"
                onClick={props.onSignIn}
                aria-label={t("nav.signIn")}
                data-testid="sidebar-sign-in"
              >
                <LogInIcon size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("nav.signIn")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="outline"
            className="w-full gap-2 [&_svg]:pointer-events-auto"
            onClick={props.onSignIn}
            data-testid="sidebar-sign-in"
          >
            <LogInIcon size={16} />
            {t("nav.signIn")}
          </Button>
        )}
      </div>

      <DeleteChatDialog
        chat={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) props.onDeleteChat(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </aside>
  );
}

/** Nav row: full label when expanded; icon + tooltip when collapsed. */
function NavButton({
  collapsed,
  label,
  active,
  onClick,
  badge,
  children,
}: {
  collapsed: boolean;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string | null;
  children: React.ReactNode;
}) {
  const t = useT();
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        badge
          ? t("nav.withUnread", { label, count: badge })
          : label
      }
      className={cn(
        "nav-item",
        collapsed && "justify-center px-0",
        active ? "nav-item-active" : "nav-item-idle",
      )}
    >
      <span className={cn("relative", active ? "text-primary" : "opacity-80")}>
        {children}
        {badge && collapsed && (
          <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary" />
        )}
      </span>
      {!collapsed && (
        <>
          <span
            className={cn(
              "flex-1 text-left",
              active && "text-primary",
            )}
          >
            {label}
          </span>
          {badge && (
            <span className="ml-auto rounded-full bg-primary/90 px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-primary-foreground">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChatRow({
  chat,
  active,
  pinned,
  renaming,
  onOpen,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onResetTitle,
  hasCustomTitle,
  onRequestDelete,
  onTogglePin,
  onCancel,
}: {
  chat: Chat & { needsInput?: boolean };
  active: boolean;
  pinned?: boolean;
  renaming: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: (title: string) => void;
  onResetTitle?: () => void;
  hasCustomTitle?: boolean;
  onRequestDelete: () => void;
  onTogglePin?: () => void;
  onCancel?: (id: string) => void;
}) {
  const t = useT();
  const status = chat.latest.status;
  const needsInput = Boolean(chat.needsInput);
  const roster = rosterRowView({
    latestGoal: chat.latest.goal,
    status,
    needsInput,
  });
  const busy =
    isActiveTaskStatus(status) || needsInput;

  if (renaming) {
    return (
      <RenameField
        initial={chat.title}
        onCommit={onCommitRename}
        onCancel={onCancelRename}
      />
    );
  }

  return (
    <div
      className={cn(
        "chat-row group relative flex w-full items-start gap-2 rounded-lg pr-1 transition-all duration-150",
        active
          ? "bg-primary/[0.09] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.14)]"
          : "hover:bg-white/[0.035]",
      )}
      data-needs-input={needsInput ? "true" : undefined}
      data-testid="chat-row"
      data-roster-activity={roster.activity}
    >
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={onStartRename}
        className="flex min-w-0 flex-1 items-start gap-2.5 px-2.5 py-2 text-left"
      >
        <span
          className={cn(
            "mt-1.5 shrink-0",
            statusDotClass(needsInput ? "waiting_user" : status),
          )}
        />
        <span className="min-w-0 flex-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "block w-full truncate text-sm leading-snug",
                  active ? "text-foreground" : "text-foreground/80",
                )}
              >
                {pinned ? (
                  <span className="inline-flex items-center gap-1">
                    <Pin className="inline h-3 w-3 text-primary/80" strokeWidth={2} />
                    {chat.title}
                  </span>
                ) : (
                  chat.title
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              {chat.title}
            </TooltipContent>
          </Tooltip>
          <span
            className="mt-0.5 block truncate text-2xs text-muted-foreground"
            data-testid="chat-row-summary"
          >
            {roster.lastTurnSummary ??
              t(rosterActivityLabelKey(roster.activity))}
            {chat.updatedAt ? ` · ${relativeTime(chat.updatedAt)}` : ""}
          </span>
        </span>
      </button>

      <div className="mt-1.5 mr-0.5 flex shrink-0 items-center">
        {busy && onCancel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("nav.stopTask")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-destructive-text group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel(chat.latest.id);
                }}
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("nav.stopTask")}</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("nav.chatOptions")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("nav.chatOptions")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            className="w-40 border-white/10"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenuItem onSelect={() => onStartRename()}>
              <Pencil className="h-4 w-4" />
              {t("nav.rename")}
            </DropdownMenuItem>
            {hasCustomTitle && onResetTitle && (
              <DropdownMenuItem
                data-testid="chat-row-reset-title"
                onSelect={() => onResetTitle()}
              >
                <RotateCcw className="h-4 w-4" />
                {t("nav.resetTitle")}
              </DropdownMenuItem>
            )}
            {onTogglePin && (
              <DropdownMenuItem onSelect={() => onTogglePin()}>
                <Pin className="h-4 w-4" />
                {pinned ? t("nav.unpin") : t("nav.pin")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-white/[0.06]" />
            <DropdownMenuItem
              className="text-destructive-text focus:text-destructive-text"
              onSelect={() => onRequestDelete()}
            >
              <Trash2Icon size={16} />
              {t("nav.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Inline title editor. Enter/blur commits, Escape cancels. */
function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="px-1.5 py-1">
      <Input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(value.trim());
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCommit(value.trim())}
        maxLength={120}
        className="h-8 rounded-lg border-primary/40 bg-white/[0.04] text-sm"
      />
    </div>
  );
}

function DeleteChatDialog({
  chat,
  onCancel,
  onConfirm,
}: {
  chat: Chat | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const roots = chat?.root.policySnapshot.workspaceRoots ?? [];
  const managed = chat
    ? !roots.some((r) => r && !isManagedWorkspace(r))
    : true;
  const folder = chat ? workspaceGroup(roots).label : "";
  return (
    <AlertDialog open={Boolean(chat)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="border-white/10">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("nav.confirmDelete")}</AlertDialogTitle>
          <AlertDialogDescription>
            {chat ? `“${chat.title}” — ` : ""}
            {t("nav.confirmDeleteBody")}
            {!managed && folder
              ? ` (${folder})`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t("nav.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t("nav.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type FolderGroup = { key: string; label: string; chats: Chat[] };

/** Bucket chats into workspace folders, filtered by a search query. */
function groupChats(chats: Chat[], query: string): FolderGroup[] {
  const q = query.trim().toLowerCase();
  const order: string[] = [];
  const map = new Map<string, FolderGroup>();
  for (const chat of chats) {
    if (q) {
      const hay = `${chat.title} ${chat.root.goal}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const g = workspaceGroup(chat.root.policySnapshot.workspaceRoots);
    let grp = map.get(g.key);
    if (!grp) {
      grp = { key: g.key, label: g.label, chats: [] };
      map.set(g.key, grp);
      order.push(g.key);
    }
    grp.chats.push(chat);
  }
  // Newest chat first inside each folder (chats arrive newest-first already).
  return order.map((k) => map.get(k)!);
}

/** Apply the user's saved folder order; unknown folders keep recency order. */
function orderFolders(groups: FolderGroup[], saved: string[]): FolderGroup[] {
  if (saved.length === 0) return groups;
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const seen = new Set<string>();
  const out: FolderGroup[] = [];
  for (const key of saved) {
    const g = byKey.get(key);
    if (g) {
      out.push(g);
      seen.add(key);
    }
  }
  for (const g of groups) if (!seen.has(g.key)) out.push(g);
  return out;
}

/**
 * A chat's workspace bucket: prefer a user project folder when present so
 * chats with an attached project group under that folder (not "Quick chats").
 * App-managed-only runs use an empty label → localized "Quick chats".
 */
function workspaceGroup(
  roots?: readonly string[] | null,
): { key: string; label: string } {
  const list = (roots ?? []).map((r) => r.trim()).filter(Boolean);
  const userRoot = list.find((r) => !isManagedWorkspace(r));
  const root = userRoot ?? list[0];
  if (!root || isManagedWorkspace(root)) {
    return { key: "__chat__", label: "" };
  }
  const norm = root.replace(/[/\\]+$/, "");
  const base = norm.split(/[/\\]/).pop() || norm;
  return { key: norm.toLowerCase(), label: base };
}

/** True for app-managed scratch workspaces (deleted with the chat). */
function isManagedWorkspace(root?: string): boolean {
  return isManagedWorkspacePath(root);
}

function loadOrder(): string[] {
  try {
    return parseFolderOrderRaw(localStorage.getItem(FOLDER_ORDER_KEY));
  } catch {
    return [];
  }
}

function saveOrder(order: string[]): void {
  try {
    localStorage.setItem(FOLDER_ORDER_KEY, JSON.stringify(capFolderOrder(order)));
  } catch {
    // Non-fatal: order just won't persist across reloads.
  }
}

/** Compact billing reset date for the sidebar footer. */
function formatResetDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString(getActiveIntlLocale(), {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
