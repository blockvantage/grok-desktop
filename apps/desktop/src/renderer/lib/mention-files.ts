export type MentionCandidate = {
  path: string;
  name: string;
  group: "attached" | "project" | "deliverable";
};

/**
 * Detect an active @mention query ending at `cursor`.
 * Returns null for email-like addresses (word char immediately before @).
 */
export function extractMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  if (cursor < 0 || cursor > text.length) return null;
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0) {
    const prev = before[at - 1]!;
    if (!/\s/.test(prev)) return null;
  }
  const afterAt = before.slice(at + 1);
  if (/\s/.test(afterAt)) return null;
  return { start: at, query: afterAt };
}

/** Normalize path separators for comparison. */
export function normalizePathSep(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Short label for composer insertion and menu rows.
 * Prefers workspace-relative path when under a known root; otherwise basename.
 */
export function mentionDisplayLabel(
  filePath: string,
  roots: string[] = [],
): string {
  const normalized = normalizePathSep(filePath);
  for (const root of roots) {
    if (!root?.trim()) continue;
    const r = normalizePathSep(root).replace(/\/+$/, "");
    if (!r) continue;
    if (normalized === r) {
      const base = normalized.split("/").pop();
      return base || normalized;
    }
    const prefix = r.endsWith("/") ? r : `${r}/`;
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

/**
 * Menu subtitle: workspace-relative when possible, else a short abbreviated path.
 * Always prefers something shorter than a raw absolute dump.
 */
export function mentionSecondaryLabel(
  filePath: string,
  roots: string[] = [],
): string {
  const normalized = normalizePathSep(filePath);
  for (const root of roots) {
    if (!root?.trim()) continue;
    const r = normalizePathSep(root).replace(/\/+$/, "");
    if (!r) continue;
    if (normalized === r) {
      return normalized.split("/").pop() || normalized;
    }
    const prefix = r.endsWith("/") ? r : `${r}/`;
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  if (parts[0] === "Users" && parts.length > 3) {
    return `~/${parts.slice(2).join("/")}`;
  }
  if (/^[A-Za-z]:$/.test(parts[0] ?? "") && parts.length > 3) {
    return `…/${parts.slice(-2).join("/")}`;
  }
  return `…/${parts.slice(-2).join("/")}`;
}

export function filterMentionCandidates(
  all: MentionCandidate[],
  query: string,
  limit = 8,
  roots: string[] = [],
): MentionCandidate[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const c of all) {
    const key = c.path;
    if (seen.has(key)) continue;
    if (q) {
      const label = mentionDisplayLabel(c.path, roots).toLowerCase();
      if (
        !c.name.toLowerCase().includes(q) &&
        !c.path.toLowerCase().includes(q) &&
        !label.includes(q)
      ) {
        continue;
      }
    }
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Insert a seamless @mention token (short label, not a full absolute path).
 * File is also staged as an attachment by the caller — path context travels there.
 */
export function insertMentionToken(
  text: string,
  cursor: number,
  start: number,
  filePath: string,
  roots: string[] = [],
): { text: string; cursor: number; label: string } {
  const label = mentionDisplayLabel(filePath, roots);
  // Quote only when spaces / backticks would break a bare token.
  const needsQuote = /[\s`]/.test(label);
  const token = needsQuote ? `@\`${label}\` ` : `@${label} `;
  const next = text.slice(0, start) + token + text.slice(cursor);
  return { text: next, cursor: start + token.length, label };
}
