/** Relative time and path helpers for the product shell. */

import { getActiveIntlLocale, t } from "@/i18n/active";
import { isMediaPath } from "@/lib/api";

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  const diff = Date.now() - parsed;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return t("time.justNow");
  const min = Math.round(sec / 60);
  if (min < 60) return t("time.minutesAgo", { n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("time.hoursAgo", { n: hr });
  const day = Math.round(hr / 24);
  if (day < 14) return t("time.daysAgo", { n: day });
  return new Date(parsed).toLocaleDateString(getActiveIntlLocale(), {
    month: "short",
    day: "numeric",
  });
}

export function shortPath(p: string): string {
  if (!p) return "";
  if (p.startsWith("~")) return p;
  const parts = p.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return p;
  // Prefer ~/… style when under home-like segments (macOS /Users/me/…, Linux /home/me/…)
  if (
    (parts[0] === "Users" || parts[0] === "home") &&
    parts.length >= 3
  ) {
    return shortHomeTail(parts.slice(2));
  }
  // Windows: C:\Users\me\… → ~/…
  if (
    parts.length >= 4 &&
    /^[A-Za-z]:$/.test(parts[0]!) &&
    /^Users$/i.test(parts[1]!)
  ) {
    return shortHomeTail(parts.slice(3));
  }
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

function shortHomeTail(parts: string[]): string {
  if (parts.length <= 4) return `~/${parts.join("/")}`;
  return `~/…/${parts.slice(-2).join("/")}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(getActiveIntlLocale(), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(getActiveIntlLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fileExt(pathOrTitle: string): string {
  const base = pathOrTitle.split(/[/\\]/).pop() ?? pathOrTitle;
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

/** Human size for artifact captions (KB/MB, one decimal when needed). */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) {
    const kb = n / 1024;
    const s = kb.toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s} KB`;
  }
  const mb = n / (1024 * 1024);
  const s = mb.toFixed(1);
  return `${s.endsWith(".0") ? s.slice(0, -2) : s} MB`;
}

/** Stable, locale-independent artifact kind, for filtering (never shown to users). */
export type ArtifactKindId = "media" | "markdown" | "excel" | "python" | "other";

interface ArtifactKindInfo {
  /** Stable id used by artifactKindId(); not affected by locale. */
  kind: ArtifactKindId;
  /** Display label used by artifactKindLabel(); evaluated lazily since some entries call t(). */
  label: () => string;
}

/**
 * Single source of truth for extension → (kind id, display label).
 * artifactKindLabel() and artifactKindId() both read from this map so the
 * extension list is defined exactly once. Image/video/audio extensions are
 * classified as "media" by isMediaPath(path) before this map is consulted
 * (see artifactKindId below), matching the artifacts view's media filter
 * check. But isMediaPath only looks at `path`, never `title`, so png/jpg/
 * jpeg/svg's `kind: "other"` here only applies in the title-fallback case
 * (path null/missing, extension taken from title) — the same case where the
 * old dedicated media branch also never matched, since it too only checked
 * a.path.
 */
const ARTIFACT_KIND_BY_EXT: Record<string, ArtifactKindInfo> = {
  md: { kind: "markdown", label: () => "Markdown" },
  markdown: { kind: "markdown", label: () => "Markdown" },
  txt: { kind: "other", label: () => t("fileKind.text") },
  pdf: { kind: "other", label: () => "PDF" },
  xlsx: { kind: "excel", label: () => "Excel" },
  xls: { kind: "excel", label: () => "Excel" },
  csv: { kind: "other", label: () => "CSV" },
  pptx: { kind: "other", label: () => "PowerPoint" },
  ppt: { kind: "other", label: () => "PowerPoint" },
  py: { kind: "python", label: () => "Python" },
  ts: { kind: "other", label: () => "TypeScript" },
  tsx: { kind: "other", label: () => "TypeScript" },
  js: { kind: "other", label: () => "JavaScript" },
  json: { kind: "other", label: () => "JSON" },
  png: { kind: "other", label: () => "PNG" },
  jpg: { kind: "other", label: () => "JPEG" },
  jpeg: { kind: "other", label: () => "JPEG" },
  svg: { kind: "other", label: () => "SVG" },
  sql: { kind: "other", label: () => "SQL" },
};

/**
 * Own-property-only lookup: file extensions come straight from user file
 * names, so a file called "foo.__proto__" or "foo.constructor" must not
 * resolve to Object.prototype members of the plain-object map above.
 */
function lookupArtifactKind(ext: string): ArtifactKindInfo | undefined {
  return Object.hasOwn(ARTIFACT_KIND_BY_EXT, ext)
    ? ARTIFACT_KIND_BY_EXT[ext]
    : undefined;
}

export function artifactKindLabel(
  path: string | null | undefined,
  title: string,
): string {
  const ext = fileExt(path || title);
  const info = lookupArtifactKind(ext);
  if (info) return info.label();
  return ext ? ext.toUpperCase() : t("fileKind.file");
}

/**
 * Locale-independent counterpart to artifactKindLabel(), for the artifacts
 * type filter. Unlike the label, this never changes with the active locale,
 * so filtering doesn't break when the UI language isn't English (H-12).
 */
export function artifactKindId(
  path: string | null | undefined,
  title: string,
): ArtifactKindId {
  // Mirrors the artifacts view's separate media check (isMediaPath(a.path)),
  // not the label map — media files may not appear in ARTIFACT_KIND_BY_EXT
  // at all (e.g. mp4, mp3), and image extensions that *are* in the map
  // (png/jpg/svg) are still "media" for filtering purposes.
  if (isMediaPath(path)) return "media";
  const ext = fileExt(path || title);
  return lookupArtifactKind(ext)?.kind ?? "other";
}
