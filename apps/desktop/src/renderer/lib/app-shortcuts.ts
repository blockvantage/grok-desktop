/**
 * Pure keyboard shortcut resolution for the desktop App shell (Phase 6).
 * Returns intent objects; the React layer applies side effects.
 */

export type AppNavId =
  | "home"
  | "tasks"
  | "scheduled"
  | "artifacts"
  | "memory"
  | "settings";

export type ShortcutIntent =
  | { type: "new_chat" }
  | { type: "stop_live" }
  | { type: "close_palette" }
  | { type: "close_inbox" }
  | { type: "workspace_to_list" }
  | { type: "focus_composer_slash" }
  | { type: "open_inbox" }
  | { type: "copy_last_response" }
  | { type: "toggle_pin_chat" }
  | { type: "show_shortcuts" }
  | { type: "close_shortcuts" }
  | { type: "nav"; nav: AppNavId }
  | { type: "none" };

export type ShortcutContext = {
  meta: boolean;
  shift: boolean;
  key: string;
  typing: boolean;
  paletteOpen: boolean;
  inboxOpen: boolean;
  shortcutsOpen: boolean;
  nav: AppNavId | string;
  taskSurface: "list" | "workspace";
  showOnboarding: boolean;
};

const NAV_BY_DIGIT: Record<string, AppNavId> = {
  "1": "home",
  "2": "tasks",
  "3": "scheduled",
  "4": "artifacts",
  "5": "memory",
  "6": "settings",
};

/**
 * Map a keydown snapshot to a single app intent (or none).
 * Order matches prior App.tsx handlers for behavior parity.
 */
export function resolveAppShortcut(ctx: ShortcutContext): ShortcutIntent {
  const key = ctx.key;
  const lower = key.toLowerCase();

  // While the keyboard-shortcuts dialog is open it owns the keyboard: Escape or the
  // toggle (?, ⌘/) close it; every other shortcut is swallowed so nothing fires
  // underneath the modal (e.g. Escape must not also back out of the workspace).
  if (ctx.shortcutsOpen) {
    if (
      (key === "Escape" && !ctx.meta) ||
      (!ctx.meta && key === "?") ||
      (ctx.meta && key === "/")
    ) {
      return { type: "close_shortcuts" };
    }
    return { type: "none" };
  }

  // Cmd/Ctrl+N: new chat on Home
  if (ctx.meta && lower === "n") {
    return { type: "new_chat" };
  }

  // Cmd/Ctrl+.: stop live task
  if (ctx.meta && key === ".") {
    return { type: "stop_live" };
  }

  // Escape: close overlays, then back out of workspace
  if (key === "Escape" && !ctx.meta) {
    if (ctx.paletteOpen) return { type: "close_palette" };
    if (ctx.inboxOpen) return { type: "close_inbox" };
    if (!ctx.typing && ctx.nav === "tasks" && ctx.taskSurface === "workspace") {
      return { type: "workspace_to_list" };
    }
    return { type: "none" };
  }

  // / on Home (not typing): focus composer for slash commands
  if (
    !ctx.meta &&
    !ctx.typing &&
    key === "/" &&
    ctx.nav === "home" &&
    !ctx.showOnboarding
  ) {
    return { type: "focus_composer_slash" };
  }

  // ? (Shift+/) or ⌘/ : open the keyboard shortcuts reference
  if (!ctx.typing && !ctx.showOnboarding) {
    if ((!ctx.meta && key === "?") || (ctx.meta && key === "/")) {
      return { type: "show_shortcuts" };
    }
  }

  // ⌘⇧I open Inbox
  if (ctx.meta && ctx.shift && lower === "i") {
    return { type: "open_inbox" };
  }

  // ⌘⇧C copy last assistant response (workspace)
  if (ctx.meta && ctx.shift && lower === "c") {
    if (ctx.nav === "tasks" && ctx.taskSurface === "workspace") {
      return { type: "copy_last_response" };
    }
    return { type: "none" };
  }

  // ⌘⇧P pin/unpin current chat
  if (ctx.meta && ctx.shift && lower === "p") {
    if (ctx.nav === "tasks" && ctx.taskSurface === "workspace") {
      return { type: "toggle_pin_chat" };
    }
    return { type: "none" };
  }

  // ⌘1–⌘6 navigate
  if (ctx.meta && !ctx.shift && NAV_BY_DIGIT[key]) {
    return { type: "nav", nav: NAV_BY_DIGIT[key]! };
  }

  return { type: "none" };
}

/** Whether the key event target is an editable field (duck-typed for node tests). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
  };
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true
  );
}
