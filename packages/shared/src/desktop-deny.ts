/**
 * Best-effort deny heuristics for sensitive desktop targets.
 * Pure string matching — not perfect security.
 */

const HARD_BLOCK_SUBSTR = [
  "1password",
  "onepassword",
  "bitwarden",
  "lastpass",
  "dashlane",
  "keeper",
  "keepass",
  "keychain access",
  "credential manager",
];

/**
 * True when frontmost app/process should not receive automated input.
 */
export function isDeniedDesktopTarget(
  app: string | null | undefined,
  title: string | null | undefined = null,
): boolean {
  const hay = `${app ?? ""} ${title ?? ""}`.toLowerCase();
  if (!hay.trim()) return false;
  return HARD_BLOCK_SUBSTR.some((s) => hay.includes(s));
}

/** Soft caution only (auth-looking UI) — does not block. */
export function isCautionDesktopTarget(
  app: string | null | undefined,
  title: string | null | undefined = null,
): boolean {
  const hay = `${app ?? ""} ${title ?? ""}`.toLowerCase();
  return /\bpassword\b|\bsign in\b|\blogin\b/.test(hay);
}
