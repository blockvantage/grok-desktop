/** Visible settings tabs (5). Legacy deep-links alias via resolveSettingsTab. */
export type SettingsTabId =
  | "account"
  | "preferences"
  | "tools"
  | "permissions"
  | "advanced"
  /** @deprecated deep-link alias → preferences */
  | "language"
  /** @deprecated deep-link alias → advanced */
  | "license"
  /** @deprecated deep-link alias → advanced */
  | "remote";

export type ResolvedSettingsTab = Exclude<
  SettingsTabId,
  "language" | "license" | "remote"
>;

export function resolveSettingsTab(
  tab: SettingsTabId | string | undefined | null,
): ResolvedSettingsTab {
  if (tab === "language") return "preferences";
  if (tab === "license" || tab === "remote") return "advanced";
  if (
    tab === "account" ||
    tab === "preferences" ||
    tab === "tools" ||
    tab === "permissions" ||
    tab === "advanced"
  ) {
    return tab;
  }
  return "account";
}
