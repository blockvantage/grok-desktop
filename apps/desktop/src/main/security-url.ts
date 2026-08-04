/**
 * Electron navigation / external-open policy helpers (pure, unit-tested).
 * Treat model output, Markdown links, and remote content as hostile.
 */

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

const BLOCKED_EXTERNAL_PROTOCOLS = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
  "about:",
]);

export type ExternalUrlDecision =
  | { allowed: true; url: string }
  | { allowed: false; reason: string };

/**
 * Only explicit http/https external URLs may leave the app via openExternal.
 * Rejects javascript:, data:, file:, custom schemes, and empty/relative strings.
 */
export function decideExternalUrl(raw: string): ExternalUrlDecision {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return { allowed: false, reason: "empty url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { allowed: false, reason: "unparseable url" };
  }
  const protocol = parsed.protocol.toLowerCase();
  if (BLOCKED_EXTERNAL_PROTOCOLS.has(protocol)) {
    return { allowed: false, reason: `blocked scheme ${protocol}` };
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) {
    return { allowed: false, reason: `unsupported scheme ${protocol}` };
  }
  // Block credentials-in-URL as a footgun.
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: "credentials in url" };
  }
  return { allowed: true, url: parsed.toString() };
}

export type NavigationDecision =
  | { allow: true }
  | { allow: false; reason: string };

/**
 * Main window may only stay on the trusted packaged renderer origin
 * (file:// app page or vite ELECTRON_RENDERER_URL during dev).
 */
export function decideRendererNavigation(opts: {
  currentUrl: string;
  targetUrl: string;
  devServerOrigin?: string | null;
}): NavigationDecision {
  const target = String(opts.targetUrl ?? "").trim();
  if (!target) {
    return { allow: false, reason: "empty navigation target" };
  }

  // Always deny dangerous schemes even if "same origin" tricks.
  try {
    const t = new URL(target);
    const protocol = t.protocol.toLowerCase();
    if (
      protocol === "javascript:" ||
      protocol === "data:" ||
      protocol === "vbscript:"
    ) {
      return { allow: false, reason: `blocked scheme ${protocol}` };
    }
  } catch {
    return { allow: false, reason: "unparseable navigation target" };
  }

  const dev = opts.devServerOrigin?.replace(/\/$/, "") || null;
  if (dev) {
    try {
      const t = new URL(target);
      const d = new URL(dev);
      if (t.origin === d.origin) {
        return { allow: true };
      }
    } catch {
      /* fall through */
    }
  }

  // Packaged: only allow file: URLs under the same path directory as current,
  // or identical current document navigations (hash).
  try {
    const current = new URL(opts.currentUrl);
    const next = new URL(target);
    if (current.protocol === "file:" && next.protocol === "file:") {
      // Same file or hash-only navigation.
      if (current.pathname === next.pathname) {
        return { allow: true };
      }
      return { allow: false, reason: "navigation away from packaged renderer" };
    }
    if (current.origin && next.origin && current.origin === next.origin) {
      // Dev already handled; same-origin non-dev still restricted to exact path family.
      if (current.pathname === next.pathname) {
        return { allow: true };
      }
    }
  } catch {
    return { allow: false, reason: "navigation parse error" };
  }

  return { allow: false, reason: "navigation away from trusted origin" };
}

/**
 * Markdown / model-rendered links: only http(s) or relative app anchors.
 */
export function sanitizeMarkdownHref(href: string | undefined): string | null {
  if (!href) return null;
  const t = href.trim();
  if (!t) return null;
  if (t.startsWith("#")) return t;
  const decision = decideExternalUrl(t);
  return decision.allowed ? decision.url : null;
}
