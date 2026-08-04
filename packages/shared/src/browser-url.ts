export type UrlCheck = { blocked: boolean; reason?: string };

export function hasBrowserUrlControlCharacters(raw: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(raw);
}

export function parseBrowserUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * True for agent HTML deliverables loaded via loadFile:
 * absolute paths (…/index.html) or file://…/*.html
 * These are NOT parseable as http(s) origins and must not hit Invalid URL.
 */
export function isLocalHtmlDeliverable(raw: string): boolean {
  if (!raw || hasBrowserUrlControlCharacters(raw)) return false;
  const s = raw.trim();
  if (
    !s.includes("://") &&
    (s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s)) &&
    /\.html?$/i.test(s)
  ) {
    return true;
  }
  if (s.startsWith("file:")) {
    try {
      const u = new URL(s);
      return u.protocol === "file:" && /\.html?$/i.test(u.pathname);
    } catch {
      return /\.html?$/i.test(s);
    }
  }
  return false;
}

export function originOf(url: URL): string {
  return url.origin;
}

export function isSameOrigin(a: string, b: string): boolean {
  const ua = parseBrowserUrl(a);
  const ub = parseBrowserUrl(b);
  if (!ua || !ub) return false;
  return ua.origin === ub.origin;
}

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  // CGNAT / shared address space (RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "::") {
    return true;
  }
  // IPv4-mapped IPv6 — Node may keep dotted form or rewrite to hex
  // (::ffff:127.0.0.1 → ::ffff:7f00:1).
  const v4Dotted =
    /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(h);
  if (v4Dotted) {
    return isPrivateIpv4(Number(v4Dotted[1]), Number(v4Dotted[2]));
  }
  const v4Hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (v4Hex) {
    const hi = parseInt(v4Hex[1]!, 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    return isPrivateIpv4(a, b);
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    return isPrivateIpv4(Number(m[1]), Number(m[2]));
  }
  // ULA / link-local IPv6 (fc00::/7, fe80::/10) — coarse prefix match
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
    return true;
  }
  return false;
}

export function isBlockedBrowserUrl(raw: string): UrlCheck {
  if (hasBrowserUrlControlCharacters(raw)) {
    return { blocked: true, reason: "URL contains control characters" };
  }
  // Absolute local paths / file HTML — allowed for isolated pane loadFile.
  if (isLocalHtmlDeliverable(raw)) {
    return { blocked: false };
  }

  const url = parseBrowserUrl(raw);
  if (!url) return { blocked: true, reason: "Invalid URL" };
  if (url.protocol === "file:") {
    // Non-HTML file:// stays blocked (see isLocalHtmlDeliverable for HTML).
    return { blocked: true, reason: "file:// URLs are not allowed" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { blocked: true, reason: `Protocol ${url.protocol} is not allowed` };
  }
  if (url.username || url.password) {
    return { blocked: true, reason: "URLs with credentials are not allowed" };
  }
  if (isPrivateHostname(url.hostname)) {
    return {
      blocked: true,
      reason: "Local and private network URLs require elevation",
    };
  }
  return { blocked: false };
}
