/**
 * Command palette ranking / visibility for simplified daily Desk.
 * Daily actions first; setup/admin demoted and often hidden when healthy.
 */

export type PaletteActionId =
  | "new_task"
  | "open_inbox"
  | "stop_task"
  | "open_recent"
  | "shortcuts"
  | "sign_in"
  | "run_setup"
  | "usage"
  | "billing"
  | "docs"
  | "navigate"
  | "open_settings";

export type PaletteSectionId = "daily" | "goto" | "stop" | "recent" | "admin";

/** Primary navigation targets (settings is demoted into admin). */
export const PALETTE_PRIMARY_NAV_IDS = [
  "home",
  "tasks",
  "scheduled",
  "artifacts",
  "memory",
] as const;

/**
 * Whether "Run setup again" belongs in the daily palette.
 * Only when readiness is blocked — otherwise setup lives in Settings.
 */
export function shouldShowRunSetupInPalette(input: {
  readinessBlocked: boolean;
}): boolean {
  return input.readinessBlocked === true;
}

/**
 * Section order for the palette list (top → bottom).
 * Daily work first; setup/billing/docs last.
 */
export function paletteSectionOrder(): PaletteSectionId[] {
  return ["daily", "stop", "recent", "goto", "admin"];
}

/**
 * Rank within the daily section (lower = higher priority).
 * New task → continue/inbox → stop/open recent live in sibling sections
 * but daily chrome prioritizes create + needs-you over help/sign-in.
 */
export function dailyActionRank(id: PaletteActionId): number {
  const order: PaletteActionId[] = [
    "new_task",
    "open_inbox",
    "stop_task",
    "open_recent",
    "shortcuts",
    "sign_in",
  ];
  const i = order.indexOf(id);
  return i === -1 ? 100 : i;
}

/**
 * Rank within the admin section (lower = higher in that demoted group).
 * Setup only when blocked; then usage/billing/docs/settings.
 */
export function adminActionRank(id: PaletteActionId): number {
  const order: PaletteActionId[] = [
    "run_setup",
    "usage",
    "billing",
    "docs",
    "open_settings",
  ];
  const i = order.indexOf(id);
  return i === -1 ? 100 : i;
}

/**
 * Classify an action into palette section for structure tests / rendering.
 */
export function paletteSectionForAction(
  id: PaletteActionId,
  ctx: { readinessBlocked: boolean; signedIn: boolean },
): PaletteSectionId | null {
  if (id === "run_setup") {
    return shouldShowRunSetupInPalette(ctx) ? "admin" : null;
  }
  if (
    id === "usage" ||
    id === "billing" ||
    id === "docs" ||
    id === "open_settings"
  ) {
    return "admin";
  }
  if (id === "navigate") return "goto";
  if (id === "stop_task") return "stop";
  if (id === "open_recent") return "recent";
  if (id === "sign_in") return ctx.signedIn ? null : "daily";
  if (id === "new_task" || id === "open_inbox" || id === "shortcuts") {
    return "daily";
  }
  return "daily";
}

/**
 * True when daily section items should render before admin items in DOM order.
 * Used by structure tests against the shipped ranking tables.
 */
export function dailyBeforeAdmin(sections: PaletteSectionId[]): boolean {
  const daily = sections.indexOf("daily");
  const admin = sections.indexOf("admin");
  if (daily === -1) return admin === -1;
  if (admin === -1) return true;
  return daily < admin;
}

/**
 * Ordered daily action ids for empty-filter rendering.
 */
export function orderedDailyActions(ctx: {
  signedIn: boolean;
  hasInbox: boolean;
  hasShortcuts: boolean;
}): PaletteActionId[] {
  const ids: PaletteActionId[] = ["new_task"];
  if (ctx.hasInbox) ids.push("open_inbox");
  if (ctx.hasShortcuts) ids.push("shortcuts");
  if (!ctx.signedIn) ids.push("sign_in");
  return ids.sort((a, b) => dailyActionRank(a) - dailyActionRank(b));
}

/**
 * Ordered admin action ids given callbacks and readiness.
 * Run setup is omitted unless readiness is blocked.
 */
export function orderedAdminActions(ctx: {
  readinessBlocked: boolean;
  hasUsage: boolean;
  hasBilling: boolean;
  hasDocs: boolean;
  hasSetup: boolean;
  hasSettings?: boolean;
}): PaletteActionId[] {
  const ids: PaletteActionId[] = [];
  if (ctx.hasSetup && shouldShowRunSetupInPalette(ctx)) {
    ids.push("run_setup");
  }
  if (ctx.hasUsage) ids.push("usage");
  if (ctx.hasBilling) ids.push("billing");
  if (ctx.hasDocs) ids.push("docs");
  if (ctx.hasSettings !== false) ids.push("open_settings");
  return ids.sort((a, b) => adminActionRank(a) - adminActionRank(b));
}
