import { useEffect, useMemo } from "react";
import { Command } from "cmdk";
import {
  Boxes,
  CalendarClock,
  Home,
  Inbox,
  Keyboard,
  ListChecks,
  LogIn,
  BookMarked,
  Plus,
  Settings,
  Sparkles,
  Square,
} from "lucide-react";
import { statusDotClass } from "@/lib/status-styles";
import { taskStatusLabel } from "@/lib/labels";
import { isActiveTaskStatus, type Task } from "@grokdesk/shared";
import type { NavId } from "@/components/shell/app-sidebar";
import { useT } from "@/i18n";
import {
  orderedAdminActions,
  orderedDailyActions,
  PALETTE_PRIMARY_NAV_IDS,
  shouldShowRunSetupInPalette,
  type PaletteActionId,
} from "@/lib/command-palette-policy";
import { MOTION_SURFACE_CLASSES } from "@/lib/motion-system";

const NAV_ICONS: Record<NavId, React.ReactNode> = {
  home: <Home className="h-4 w-4" strokeWidth={1.75} />,
  tasks: <ListChecks className="h-4 w-4" strokeWidth={1.75} />,
  scheduled: <CalendarClock className="h-4 w-4" strokeWidth={1.75} />,
  artifacts: <Boxes className="h-4 w-4" strokeWidth={1.75} />,
  memory: <BookMarked className="h-4 w-4" strokeWidth={1.75} />,
  settings: <Settings className="h-4 w-4" strokeWidth={1.75} />,
};

const groupHeadingClass =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-muted-foreground";

/** Admin/setup group: lower visual weight than daily work (no sub-AA muted alpha). */
const adminGroupClass = `${groupHeadingClass} opacity-90`;

const adminItemClass =
  "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors duration-100 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-foreground";

export function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  signedIn: boolean;
  /**
   * When true, "Run setup again" may appear under admin.
   * Healthy desks keep setup out of the daily palette.
   */
  readinessBlocked?: boolean;
  onNewTask: () => void;
  onNavigate: (id: NavId) => void;
  onOpenTask: (id: string) => void;
  onStopTask: (id: string) => void;
  onSignIn: () => void;
  onOpenUsage?: () => void;
  onOpenBilling?: () => void;
  onOpenDocs?: () => void;
  onRunSetupAgain?: () => void;
  /** SH-7: open Inbox from palette with unread count. */
  onOpenInbox?: () => void;
  onShowShortcuts?: () => void;
  inboxUnread?: number;
}) {
  const t = useT();
  const { open, onOpenChange } = props;

  // Primary destinations only — Settings lives under demoted admin.
  const primaryNav = useMemo(
    () =>
      PALETTE_PRIMARY_NAV_IDS.map((id) => ({
        id: id as NavId,
        label: t(`nav.${id}`),
        icon: NAV_ICONS[id as NavId],
      })),
    [t],
  );

  // Toggle with Cmd/Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const runningTasks = useMemo(
    () => props.tasks.filter((task) => isActiveTaskStatus(task.status)),
    [props.tasks],
  );

  const recentTasks = useMemo(() => props.tasks.slice(0, 8), [props.tasks]);

  const readinessBlocked = Boolean(props.readinessBlocked);
  const showSetup = shouldShowRunSetupInPalette({ readinessBlocked });

  const dailyActions = useMemo(
    () =>
      orderedDailyActions({
        signedIn: props.signedIn,
        hasInbox: Boolean(props.onOpenInbox),
        hasShortcuts: Boolean(props.onShowShortcuts),
      }),
    [props.signedIn, props.onOpenInbox, props.onShowShortcuts],
  );

  const adminActions = useMemo(
    () =>
      orderedAdminActions({
        readinessBlocked,
        hasUsage: Boolean(props.onOpenUsage),
        hasBilling: Boolean(props.onOpenBilling),
        hasDocs: Boolean(props.onOpenDocs),
        hasSetup: Boolean(props.onRunSetupAgain),
        hasSettings: true,
      }),
    [
      readinessBlocked,
      props.onOpenUsage,
      props.onOpenBilling,
      props.onOpenDocs,
      props.onRunSetupAgain,
    ],
  );

  const hasAdmin = adminActions.length > 0;

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  function runDaily(id: PaletteActionId) {
    switch (id) {
      case "new_task":
        run(props.onNewTask);
        break;
      case "open_inbox":
        run(() => props.onOpenInbox?.());
        break;
      case "shortcuts":
        run(() => props.onShowShortcuts?.());
        break;
      case "sign_in":
        run(props.onSignIn);
        break;
      default:
        break;
    }
  }

  function runAdmin(id: PaletteActionId) {
    switch (id) {
      case "run_setup":
        if (props.onRunSetupAgain) run(props.onRunSetupAgain);
        break;
      case "usage":
        run(() => props.onOpenUsage?.());
        break;
      case "billing":
        run(() => props.onOpenBilling?.());
        break;
      case "docs":
        run(() => props.onOpenDocs?.());
        break;
      case "open_settings":
        run(() => props.onNavigate("settings"));
        break;
      default:
        break;
    }
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("command.title")}
      shouldFilter
      className="flex flex-col"
      overlayClassName={`fixed inset-0 z-[110] bg-black/50 data-[state=open]:animate-fade-in ${MOTION_SURFACE_CLASSES.paletteOverlay}`}
      contentClassName={`surface-float fixed left-1/2 top-[14vh] z-[120] w-[min(40rem,calc(100vw-2rem))] overflow-hidden p-0 ${MOTION_SURFACE_CLASSES.palette}`}
      data-testid="command-palette"
    >
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />
        <Command.Input
          autoFocus
          placeholder={t("command.searchTasks")}
          className="h-12 w-full border-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="kbd shrink-0">esc</kbd>
      </div>

      <Command.List className="max-h-[50vh] overflow-y-auto overflow-x-hidden p-2">
        <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
          {t("command.empty")}
        </Command.Empty>

        {/* Daily actions first: new task, inbox, shortcuts, sign-in */}
        <Command.Group
          heading={t("command.actions")}
          className={groupHeadingClass}
          data-palette-section="daily"
        >
          {dailyActions.map((id) => (
            <DailyActionItem
              key={id}
              id={id}
              t={t}
              inboxUnread={props.inboxUnread ?? 0}
              onSelect={() => runDaily(id)}
            />
          ))}
        </Command.Group>

        {runningTasks.length > 0 && (
          <Command.Group
            heading={t("command.stopHeading")}
            className={groupHeadingClass}
            data-palette-section="stop"
          >
            {runningTasks.map((task) => (
              <PaletteItem
                key={`stop-${task.id}`}
                value={`stop ${task.goal} ${task.id}`}
                keywords={["stop", "cancel"]}
                onSelect={() => run(() => props.onStopTask(task.id))}
                data-palette-action="stop_task"
              >
                <Square className="h-3.5 w-3.5 text-destructive-text" />
                <span className="min-w-0 flex-1 truncate">{task.goal}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {t("command.stop")}
                </span>
              </PaletteItem>
            ))}
          </Command.Group>
        )}

        {recentTasks.length > 0 && (
          <Command.Group
            heading={t("home.recentTasks")}
            className={groupHeadingClass}
            data-palette-section="recent"
          >
            {recentTasks.map((task) => (
              <PaletteItem
                key={`open-${task.id}`}
                value={`${task.goal} ${task.id}`}
                keywords={["open", "recent", "continue", "current"]}
                onSelect={() => run(() => props.onOpenTask(task.id))}
                data-palette-action="open_recent"
              >
                <span className={statusDotClass(task.status)} />
                <span className="min-w-0 flex-1 truncate">{task.goal}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {taskStatusLabel(task.status)}
                </span>
              </PaletteItem>
            ))}
          </Command.Group>
        )}

        <Command.Group
          heading={t("command.goTo")}
          className={groupHeadingClass}
          data-palette-section="goto"
        >
          {primaryNav.map((item) => (
            <PaletteItem
              key={item.id}
              keywords={["go", "open", item.label.toLowerCase()]}
              onSelect={() => run(() => props.onNavigate(item.id))}
              data-palette-action="navigate"
            >
              <span className="text-muted-foreground">{item.icon}</span>
              {item.label}
            </PaletteItem>
          ))}
        </Command.Group>

        {hasAdmin && (
          <Command.Group
            heading={t("command.admin")}
            className={adminGroupClass}
            data-palette-section="admin"
            data-palette-demoted="true"
          >
            {adminActions.map((id) => (
              <AdminActionItem
                key={id}
                id={id}
                t={t}
                showSetup={showSetup}
                onSelect={() => runAdmin(id)}
              />
            ))}
          </Command.Group>
        )}
      </Command.List>

      <div className="flex items-center justify-between border-t border-white/[0.06] px-3.5 py-2 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd>
          <span>{t("command.navigate")}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↵</kbd>
            <span>{t("command.openAction")}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">esc</kbd>
            <span>{t("command.closeAction")}</span>
          </span>
        </span>
      </div>
    </Command.Dialog>
  );
}

function DailyActionItem({
  id,
  t,
  inboxUnread,
  onSelect,
}: {
  id: PaletteActionId;
  t: (key: string) => string;
  inboxUnread: number;
  onSelect: () => void;
}) {
  if (id === "new_task") {
    return (
      <PaletteItem
        keywords={["new", "create", "run", "task", "chat"]}
        onSelect={onSelect}
        data-palette-action="new_task"
      >
        <Plus className="h-4 w-4 text-primary" strokeWidth={1.75} />
        {t("command.newTask")}
        <span className="ml-auto flex gap-0.5">
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">N</kbd>
        </span>
      </PaletteItem>
    );
  }
  if (id === "open_inbox") {
    return (
      <PaletteItem
        keywords={["inbox", "approvals", "needs you", "unread"]}
        onSelect={onSelect}
        data-palette-action="open_inbox"
      >
        <Inbox className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        {t("inbox.openInbox")}
        {inboxUnread > 0 && (
          <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-2xs tabular-nums text-primary">
            {inboxUnread}
          </span>
        )}
        <span className="ml-auto flex gap-0.5">
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">⇧</kbd>
          <kbd className="kbd">I</kbd>
        </span>
      </PaletteItem>
    );
  }
  if (id === "shortcuts") {
    return (
      <PaletteItem
        keywords={["shortcuts", "keyboard", "keys", "help", "hotkeys"]}
        onSelect={onSelect}
        data-palette-action="shortcuts"
      >
        <Keyboard
          className="h-4 w-4 text-muted-foreground"
          strokeWidth={1.75}
        />
        {t("command.shortcuts")}
        <span className="ml-auto flex gap-0.5">
          <kbd className="kbd">?</kbd>
        </span>
      </PaletteItem>
    );
  }
  if (id === "sign_in") {
    return (
      <PaletteItem
        keywords={["sign in", "login", "supergrok", "auth"]}
        onSelect={onSelect}
        data-palette-action="sign_in"
      >
        <LogIn className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        {t("settings.signInSuperGrok")}
      </PaletteItem>
    );
  }
  return null;
}

function AdminActionItem({
  id,
  t,
  showSetup,
  onSelect,
}: {
  id: PaletteActionId;
  t: (key: string) => string;
  showSetup: boolean;
  onSelect: () => void;
}) {
  if (id === "run_setup") {
    if (!showSetup) return null;
    return (
      <PaletteItem
        keywords={["setup", "onboarding", "wizard", "first run"]}
        onSelect={onSelect}
        data-palette-action="run_setup"
        className={adminItemClass}
      >
        <Sparkles className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        {t("settings.runSetupAgain")}
      </PaletteItem>
    );
  }
  if (id === "usage") {
    return (
      <PaletteItem
        keywords={["usage", "credits", "billing", "quota"]}
        onSelect={onSelect}
        data-palette-action="usage"
        className={adminItemClass}
      >
        <Settings className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        {t("command.usage")}
      </PaletteItem>
    );
  }
  if (id === "billing") {
    return (
      <PaletteItem
        keywords={["billing", "manage", "plan", "upgrade"]}
        onSelect={onSelect}
        data-palette-action="billing"
        className={adminItemClass}
      >
        <Settings className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        {t("command.billing")}
      </PaletteItem>
    );
  }
  if (id === "docs") {
    return (
      <PaletteItem
        keywords={["help", "docs", "documentation"]}
        onSelect={onSelect}
        data-palette-action="docs"
        className={adminItemClass}
      >
        <BookMarked
          className="h-4 w-4 text-muted-foreground"
          strokeWidth={1.75}
        />
        {t("command.docs")}
      </PaletteItem>
    );
  }
  if (id === "open_settings") {
    return (
      <PaletteItem
        keywords={["settings", "preferences", "config", "account"]}
        onSelect={onSelect}
        data-palette-action="open_settings"
        className={adminItemClass}
      >
        <Settings className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        {t("nav.settings")}
      </PaletteItem>
    );
  }
  return null;
}

function PaletteItem({
  children,
  onSelect,
  value,
  keywords,
  className,
  ...rest
}: {
  children: React.ReactNode;
  onSelect: () => void;
  value?: string;
  keywords?: string[];
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className={
        className ??
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground/90 transition-colors duration-100 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-foreground"
      }
      {...rest}
    >
      {children}
    </Command.Item>
  );
}
