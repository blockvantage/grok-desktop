/**
 * Resolve tray / deep-link navigate targets into App nav + settings tab
 * (Phase 6 extract from App subscribeNavigate).
 */

export type NavigateTargetLike = {
  nav?: string;
  settingsTab?: string;
};

export type NavigateIntent =
  | { type: "settings"; settingsTab?: string }
  | { type: "nav"; nav: "home" | "tasks" }
  | { type: "none" };

/**
 * Map a navigate payload to a high-level intent.
 * Settings tab resolution is left to the caller (resolveSettingsTab).
 */
export function navigateTargetIntent(target: NavigateTargetLike): NavigateIntent {
  if (target.nav === "settings" || target.settingsTab) {
    return {
      type: "settings",
      settingsTab: target.settingsTab,
    };
  }
  if (target.nav === "home" || target.nav === "tasks") {
    return { type: "nav", nav: target.nav };
  }
  return { type: "none" };
}

/**
 * Whether any task is live for adaptive polling seed.
 */
export function anyLiveTasks(
  tasks: Array<{ status: string }>,
  isActive: (status: string) => boolean,
): boolean {
  return tasks.some((task) => isActive(task.status));
}
