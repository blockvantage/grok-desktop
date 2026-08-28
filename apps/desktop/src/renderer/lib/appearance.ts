/**
 * Appearance preference (Phase 2.6). Dark is the crafted default.
 * "system" follows prefers-color-scheme.
 */

export type AppearancePreference = "dark" | "light" | "system";
export type ResolvedAppearance = "dark" | "light";

export const APPEARANCE_STORAGE_KEY = "grokdesk.appearance.v1";

export function isAppearancePreference(
  value: string | null | undefined,
): value is AppearancePreference {
  return value === "dark" || value === "light" || value === "system";
}

export function detectSystemDark(
  match: { matches: boolean } | null = typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null,
): boolean {
  return match?.matches ?? true;
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemDark: boolean,
): ResolvedAppearance {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export function loadAppearancePreference(): AppearancePreference {
  try {
    if (typeof localStorage === "undefined") return "dark";
    const v = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearancePreference(v) ? v : "dark";
  } catch {
    return "dark";
  }
}

export function storeAppearancePreference(pref: AppearancePreference): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(APPEARANCE_STORAGE_KEY, pref);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Stamp the resolved theme on <html> so CSS tokens and mermaid can follow. */
export function applyAppearance(resolved: ResolvedAppearance): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
