/**
 * Structural helpers for premium surface continuity checks.
 * Forward-scan bare user-facing English on shell surfaces so i18n stays complete.
 */

/** Class applied to the main content column for View Transitions morphing. */
export const CONTENT_SURFACE_VT_CLASS = "vt-content";

/** Class applied to compose boxes for shared-element transitions. */
export const COMPOSE_SURFACE_VT_CLASS = "vt-compose";

/** Motion easing used for premium hover/panel transitions (must match CSS). */
export const PREMIUM_EASE_CLASS = "ease-premium";

/**
 * Primary shell surfaces that must not ship bare English user copy.
 * Paths are relative to `apps/desktop/src/renderer/`.
 */
export const SHELL_I18N_SURFACE_FILES: readonly string[] = [
  "App.tsx",
  "components/views/memory-view.tsx",
  "components/views/tasks-view.tsx",
  "components/views/scheduled-view.tsx",
  "components/views/home-view.tsx",
  "components/views/artifacts-view.tsx",
  "components/views/task-workspace-view.tsx",
  "components/views/settings-view.tsx",
  "components/views/settings/remote-tab.tsx",
  "components/shell/app-topbar.tsx",
  "components/shell/app-sidebar.tsx",
  "components/command-palette.tsx",
  "components/browser-globe.tsx",
  "components/task-stream.tsx",
  "components/inbox-panel.tsx",
  "components/empty-state.tsx",
  "components/recovery-banner.tsx",
  "components/onboarding-wizard.tsx",
];

/**
 * Documented non-user-copy literals allowed on shell surfaces
 * (file types, technical tokens, brand/product names used as status chips).
 */
export const ALLOWED_SHELL_LITERALS: ReadonlySet<string> = new Set([
  "Markdown",
  "Excel",
  "PDF",
  "SuperGrok",
  "Grok",
  "Grok Desk",
  "xAI",
  "Finder",
  "UTC",
  "Shell", // badge prefix "Shell on/off" uses common.on/off for second word
  "OK",
  "HTTP",
  "HTTPS",
  "URL",
  "API",
  "MCP",
  "CLI",
  "ID",
  "G",
  "K",
  "N",
  "·",
  "…",
  "...",
  "—",
  "–",
  "•",
  "⌘",
  "↵",
  "↑",
  "↓",
  "esc",
  "Esc",
]);

/** Props whose string values are typically user-visible chrome. */
const USER_FACING_PROPS =
  "title|label|placeholder|description|heading|aria-label|aria-description|alt|emptyTitle|emptyDesc|actionLabel";

/** Strip line and block comments so structural gates ignore commentary. */
export function stripSourceComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Remove import lines so package paths are not scanned as copy. */
export function stripImports(source: string): string {
  return source.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, " ");
}

/** Remove string contents already inside t("...") / t('...'). */
export function stripI18nCalls(source: string): string {
  return source.replace(/\bt\(\s*(["'`])(?:\\.|(?!\1).)*\1/g, "t(_)");
}

/** True if a string looks like Tailwind / utility class soup, not prose. */
export function looksLikeClassList(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/[\[\]%]/.test(t)) return true;
  if (/^(bg|text|border|flex|grid|gap|p[xytblr]?|m[xytblr]?|w|h|min|max|rounded|shadow|hover|focus|active|sm|md|lg|xl|2xl|transition|duration|ease|animate|opacity|z|inset|top|left|right|bottom|items|justify|self|overflow|truncate|relative|absolute|fixed|sticky|pointer|select|cursor|ring|from|to|via)-/.test(t)) {
    return true;
  }
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const utilish = tokens.filter(
      (tok) =>
        /[-/[]/.test(tok) ||
        /^(flex|grid|block|hidden|relative|absolute|solid|truncate|inline|shrink|grow|contents)$/.test(
          tok,
        ),
    );
    if (utilish.length >= tokens.length - 0) return true;
    if (utilish.length / tokens.length >= 0.6) return true;
  }
  return false;
}

/** True if the string is user-facing prose that should go through i18n. */
export function isLikelyUserProse(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  if (ALLOWED_SHELL_LITERALS.has(t)) return false;
  // Code fragments / JSX leftovers
  if (
    /[{}=;]|===|!==|\?\s*\(|\)\s*:|=>|\bvoid\b|\bPromise\b|\bas\s+Array\b|&&|\|\||\bcollapsed\b|\btypeof\b/.test(
      t,
    )
  ) {
    return false;
  }
  if (/[()]/.test(t) && !/[A-Za-z]{3,}\s+[a-z]/.test(t)) return false;
  if (looksLikeClassList(t)) return false;
  // Paths / urls / pure technical ids
  if (t.startsWith("http://") || t.startsWith("https://")) return false;
  if (t.startsWith(".") || t.startsWith("#") || t.startsWith("@")) return false;
  if (t.includes("${")) return false;
  if (/^\d+([.%pxmsrememvhvw]*)$/i.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  // Single camelCase / snake / kebab ids
  if (/^[a-z][a-zA-Z0-9]*$/.test(t) && t.length < 28) return false;
  if (/^[a-z]+([A-Z][a-z0-9]+)+$/.test(t)) return false;
  if (/^[a-z][a-z0-9_-]*$/i.test(t) && !/\s/.test(t) && t.length < 28) {
    // Title Case single word UI labels: Deliverable, Preview, Stop, Pause
    if (/^[A-Z][a-z]{2,}$/.test(t)) return true;
    return false;
  }
  // Multi-word or sentence-like
  if (/\s/.test(t)) return true;
  // Single Title Case word (Stop, Preview, Deliverable)
  if (/^[A-Z][a-z]{2,}$/.test(t)) return true;
  // Ends with ellipsis / question (UI microcopy)
  if (/[…?!.]$/.test(t) && /[A-Za-z]/.test(t)) return true;
  return false;
}

function addHit(found: Set<string>, raw: string): void {
  const t = raw.replace(/\\(['"ntr\\])/g, (_, c: string) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    return c;
  }).trim();
  if (isLikelyUserProse(t)) found.add(t);
}

/**
 * Scan TSX/TS source for bare user-facing string literals and JSX text.
 * Returns unique prose strings that should go through i18n `t(...)`.
 */
export function findBareUserFacingLiterals(source: string): string[] {
  let code = stripSourceComments(source);
  code = stripImports(code);
  code = stripI18nCalls(code);

  const found = new Set<string>();

  // 1) JSX text nodes between tags (no nested tags on the same line).
  const jsxText = />\s*([^<>{\n]+?)\s*</g;
  let m: RegExpExecArray | null;
  while ((m = jsxText.exec(code)) !== null) {
    addHit(found, m[1]!);
  }

  // 2) User-facing props: title="…", placeholder='…', aria-label="…"
  const propRe = new RegExp(
    `\\b(?:${USER_FACING_PROPS})\\s*=\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`,
    "g",
  );
  while ((m = propRe.exec(code)) !== null) {
    addHit(found, m[2]!);
  }

  // 3) Nullish/or fallbacks used for UI defaults: || "…", ?? "…"
  const fallbacks = /(?:\|\||\?\?)\s*(["'])((?:\\.|(?!\1).)*)\1/g;
  while ((m = fallbacks.exec(code)) !== null) {
    addHit(found, m[2]!);
  }

  // 4) Ternary string branches: ? "…" : "…"
  const ternary =
    /\?\s*(["'])((?:\\.|(?!\1).)*)\1\s*:\s*(["'])((?:\\.|(?!\3).)*)\3/g;
  while ((m = ternary.exec(code)) !== null) {
    addHit(found, m[2]!);
    addHit(found, m[4]!);
  }

  // 5) toast / alert object fields: description: "…", message: "…"
  const objCopy =
    /\b(?:description|message|body|emptyTitle|emptyDesc|actionLabel)\s*:\s*(["'])((?:\\.|(?!\1).)*)\1/g;
  while ((m = objCopy.exec(code)) !== null) {
    addHit(found, m[2]!);
  }

  return [...found].sort();
}

/** True when a CSS blob honors prefers-reduced-motion for polish animations. */
export function cssHonorsReducedMotion(css: string): boolean {
  return (
    css.includes("prefers-reduced-motion") &&
    (css.includes("animation-duration: 0.01ms") ||
      css.includes("animation-duration:0.01ms") ||
      css.includes("transition-duration: 0.01ms") ||
      css.includes("no-preference"))
  );
}

/** True when CSS defines the content-surface view-transition group. */
export function cssHasContentSurfaceTransition(css: string): boolean {
  return (
    css.includes("content-surface") ||
    css.includes("vt-content") ||
    css.includes("compose-surface")
  );
}
