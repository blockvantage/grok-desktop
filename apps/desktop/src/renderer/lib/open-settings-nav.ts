/**
 * Pure nav state for opening Settings with a resolved tab (Phase 6 extract).
 */

import {
  resolveSettingsTab,
  type ResolvedSettingsTab,
  type SettingsTabId,
} from "./settings-tab";

export type OpenSettingsNavState = {
  nav: "settings";
  settingsTab: ResolvedSettingsTab;
};

/**
 * Open settings to a specific tab (aliases resolved).
 */
export function openSettingsNavState(
  tab?: SettingsTabId | string | null,
): OpenSettingsNavState {
  return {
    nav: "settings",
    settingsTab: resolveSettingsTab(tab),
  };
}

/**
 * Open settings Tools tab.
 */
export function openToolsNavState(): OpenSettingsNavState {
  return openSettingsNavState("tools");
}

/**
 * Open settings Account tab (usage / sign-in).
 */
export function openAccountSettingsNavState(): OpenSettingsNavState {
  return openSettingsNavState("account");
}
