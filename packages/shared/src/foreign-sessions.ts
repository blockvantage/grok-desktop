/**
 * Read-only foreign-session metadata (Phase 3.4).
 * Claude Code / Codex / Cursor — never writes, never opens WAL if we can avoid it.
 * Caps and age bounds match grok-build xai-grok-foreign-sessions.
 */

export const FOREIGN_MAX_PER_TOOL = 50;
export const FOREIGN_MAX_AGE_MS = 30 * 24 * 3600_000;
export const FOREIGN_MAX_TITLE = 200;

export const FOREIGN_TOOLS = ["claude", "codex", "cursor"] as const;
export type ForeignSessionTool = (typeof FOREIGN_TOOLS)[number];

export type ForeignSessionSummary = {
  tool: ForeignSessionTool;
  nativeId: string;
  title: string;
  cwd: string;
  updatedAt: string;
  branch: string | null;
};

export type ForeignFileEntry = {
  tool: ForeignSessionTool;
  path: string;
  nativeId: string;
  mtimeMs: number;
  /** First ~4k of the file (jsonl head or json). */
  head: string;
};

function normalizeTitle(value: string): string | null {
  const normalized = value.split(/\s+/).filter(Boolean).join(" ");
  if (!normalized) return null;
  const chars = [...normalized];
  if (chars.length <= FOREIGN_MAX_TITLE) return normalized;
  return `${chars.slice(0, FOREIGN_MAX_TITLE - 1).join("")}…`;
}

function jsonField(line: string, key: string): string | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const v = (parsed as Record<string, unknown>)[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function firstJsonField(head: string, key: string): string | null {
  for (const line of head.split("\n")) {
    const v = jsonField(line, key);
    if (v) return v;
  }
  return null;
}

function titleFromHead(head: string, fallback: string): string {
  const fromFields = [
    "customTitle",
    "aiTitle",
    "title",
    "summary",
    "lastPrompt",
  ]
    .map((key) => firstJsonField(head, key))
    .find(Boolean);
  if (fromFields) return normalizeTitle(fromFields) ?? fallback;
  for (const line of head.split("\n")) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed?.type === "user" && parsed.isMeta === true) continue;
      const content = parsed?.message;
      const text =
        typeof content === "object" && content && "content" in content
          ? (content as { content?: unknown }).content
          : parsed?.content;
      if (typeof text === "string" && text.trim()) {
        return normalizeTitle(text) ?? fallback;
      }
      if (Array.isArray(text)) {
        const block = text.find(
          (b) =>
            b &&
            typeof b === "object" &&
            (b as { type?: string }).type === "text" &&
            typeof (b as { text?: string }).text === "string",
        ) as { text: string } | undefined;
        if (block?.text) return normalizeTitle(block.text) ?? fallback;
      }
    } catch {
      /* next line */
    }
  }
  return fallback;
}

export function summarizeForeignFile(
  entry: ForeignFileEntry,
  opts?: { nowMs?: number; cwd?: string | null },
): ForeignSessionSummary | null {
  const now = opts?.nowMs ?? Date.now();
  if (now - entry.mtimeMs > FOREIGN_MAX_AGE_MS) return null;
  const storedCwd = firstJsonField(entry.head, "cwd");
  if (opts?.cwd && storedCwd && storedCwd !== opts.cwd) return null;
  const title = titleFromHead(entry.head, entry.nativeId);
  return {
    tool: entry.tool,
    nativeId: entry.nativeId,
    title,
    cwd: storedCwd ?? opts?.cwd ?? "",
    updatedAt: new Date(entry.mtimeMs).toISOString(),
    branch: firstJsonField(entry.head, "gitBranch"),
  };
}

export function finishForeignScan(
  entries: ForeignFileEntry[],
  opts?: { nowMs?: number; cwd?: string | null; limit?: number },
): ForeignSessionSummary[] {
  const limit = opts?.limit ?? FOREIGN_MAX_PER_TOOL * FOREIGN_TOOLS.length;
  const byTool = new Map<ForeignSessionTool, ForeignSessionSummary[]>();
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of sorted) {
    const summary = summarizeForeignFile(entry, opts);
    if (!summary) continue;
    const bucket = byTool.get(entry.tool) ?? [];
    if (bucket.some((s) => s.nativeId === summary.nativeId)) continue;
    if (bucket.length >= FOREIGN_MAX_PER_TOOL) continue;
    bucket.push(summary);
    byTool.set(entry.tool, bucket);
  }
  const out = FOREIGN_TOOLS.flatMap((tool) => byTool.get(tool) ?? []);
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out.slice(0, limit);
}

/** Encode a cwd the way Claude Code names project folders. */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export function foreignContinuePrompt(session: ForeignSessionSummary): string {
  const tool =
    session.tool === "claude"
      ? "Claude Code"
      : session.tool === "codex"
        ? "Codex"
        : "Cursor";
  return `Continue this work from ${tool}: ${session.title}`;
}
