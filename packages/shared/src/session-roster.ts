/**
 * Session roster + FTS search (Phase 3.4).
 * Locale-free: UI adds copy. Unknown ACP fields are ignored.
 */

export const SESSION_HEADLESS_DEFAULT = "exclude" as const;
export type SessionHeadlessPolicy = "exclude" | "include" | "only";

export const ROSTER_ACTIVITIES = [
  "working",
  "idle",
  "needs_input",
  "dormant",
  "completed",
] as const;
export type RosterActivity = (typeof ROSTER_ACTIVITIES)[number];

export type SessionSearchStatus = "ready" | "bootstrapping";

export type SessionSearchHit = {
  sessionId: string;
  title: string;
  lastTurnSummary: string | null;
  updatedAt: string | null;
  activity: RosterActivity;
  headless: boolean;
};

export type SessionSearchView = {
  status: SessionSearchStatus;
  headless: SessionHeadlessPolicy;
  hits: SessionSearchHit[];
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

export function rosterActivityFromStatus(input: {
  status: string;
  needsInput?: boolean;
}): RosterActivity {
  if (input.needsInput) return "needs_input";
  const s = input.status.trim().toLowerCase();
  if (s === "running" || s === "queued") return "working";
  if (s === "waiting_user" || s === "waiting_approval" || s === "blocked") {
    return "needs_input";
  }
  if (s === "done") return "completed";
  if (s === "failed" || s === "cancelled") return "dormant";
  return "idle";
}

export function lastTurnSummaryFromText(
  text: string | null | undefined,
  max = 96,
): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const line = clean.split(/(?<=[.!?…])\s/u)[0] ?? clean;
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

export function parseSessionHeadlessPolicy(
  raw: unknown,
): SessionHeadlessPolicy {
  if (raw === "include" || raw === "only" || raw === "exclude") return raw;
  return SESSION_HEADLESS_DEFAULT;
}

export function decodeSessionSearchStatus(raw: unknown): SessionSearchStatus {
  const p = rec(raw) ?? {};
  const token = (
    str(p.status) ??
    str(p.indexStatus) ??
    str(p.index_status) ??
    ""
  ).toLowerCase();
  if (
    token === "bootstrapping" ||
    token === "indexing" ||
    token === "building"
  ) {
    return "bootstrapping";
  }
  return "ready";
}

function decodeHeadlessFlag(row: Record<string, unknown>): boolean {
  const kind = (
    str(row.sessionKind) ??
    str(row.session_kind) ??
    str(row.kind) ??
    ""
  ).toLowerCase();
  return kind === "headless" || row.headless === true;
}

function decodeHit(raw: unknown): SessionSearchHit | null {
  const row = rec(raw);
  if (!row) return null;
  const sessionId =
    str(row.sessionId) ??
    str(row.session_id) ??
    str(row.id);
  if (!sessionId) return null;
  const title =
    str(row.title) ??
    str(row.summary) ??
    str(row.displayTitle) ??
    sessionId;
  const lastTurnSummary = lastTurnSummaryFromText(
    str(row.lastTurnSummary) ??
      str(row.last_turn_summary) ??
      str(row.firstPrompt) ??
      str(row.first_prompt),
  );
  const updatedAt =
    str(row.updatedAt) ??
    str(row.updated_at) ??
    str(row.lastActiveAt) ??
    str(row.last_active_at);
  const activity = rosterActivityFromStatus({
    status: str(row.activity) ?? str(row.status) ?? "idle",
  });
  return {
    sessionId,
    title,
    lastTurnSummary,
    updatedAt,
    activity,
    headless: decodeHeadlessFlag(row),
  };
}

export function decodeSessionSearchResponse(
  raw: unknown,
  opts?: { headless?: SessionHeadlessPolicy },
): SessionSearchView {
  const headless = opts?.headless ?? SESSION_HEADLESS_DEFAULT;
  const p = rec(raw) ?? {};
  const status = decodeSessionSearchStatus(p);
  const list =
    (Array.isArray(p.results) && p.results) ||
    (Array.isArray(p.hits) && p.hits) ||
    (Array.isArray(p.sessions) && p.sessions) ||
    (Array.isArray(raw) ? raw : []);
  let hits = list
    .map(decodeHit)
    .filter((h): h is SessionSearchHit => h != null);
  if (headless === "exclude") hits = hits.filter((h) => !h.headless);
  if (headless === "only") hits = hits.filter((h) => h.headless);
  return { status, headless, hits };
}

export type DeskConversationRow = {
  id: string;
  title?: string | null;
  goal?: string | null;
  status?: string;
  needsInput?: boolean;
  updatedAt?: string | null;
  lastTurnSummary?: string | null;
};

function hitFromDeskRow(row: DeskConversationRow): SessionSearchHit {
  const title = (row.title ?? "").trim() || row.id;
  return {
    sessionId: row.id,
    title,
    lastTurnSummary: lastTurnSummaryFromText(
      row.lastTurnSummary ?? row.goal ?? title,
    ),
    updatedAt: row.updatedAt ?? null,
    activity: rosterActivityFromStatus({
      status: row.status ?? "idle",
      needsInput: row.needsInput,
    }),
    headless: false,
  };
}

/** Roster of Desk conversations (no query). */
export function listDeskConversations(
  rows: DeskConversationRow[],
  opts?: { limit?: number },
): SessionSearchHit[] {
  const limit = opts?.limit ?? 40;
  return rows.slice(0, limit).map(hitFromDeskRow);
}

/** Local Desk conversation search (title + goal). Empty query → no hits. */
export function searchDeskConversations(
  rows: DeskConversationRow[],
  query: string,
  opts?: { limit?: number },
): SessionSearchHit[] {
  const q = query.trim().toLowerCase();
  const limit = opts?.limit ?? 24;
  if (!q) return [];
  const out: SessionSearchHit[] = [];
  for (const row of rows) {
    const title = (row.title ?? "").trim() || row.id;
    const blob = `${title} ${row.goal ?? ""} ${row.lastTurnSummary ?? ""}`.toLowerCase();
    if (!blob.includes(q)) continue;
    out.push(hitFromDeskRow(row));
    if (out.length >= limit) break;
  }
  return out;
}

export const SESSION_SEARCH_METHODS = [
  "x.ai/session/search",
  "x.ai/sessions/search",
] as const;

export const SESSION_LIST_METHODS = [
  "x.ai/session/list",
  "x.ai/sessions/list",
] as const;

export const SESSION_CHANGED_METHODS = [
  "sessions/changed",
  "x.ai/sessions/changed",
  "x.ai/session/changed",
] as const;

export function isSessionsChangedNotification(method: string): boolean {
  const m = method.trim().toLowerCase();
  return (SESSION_CHANGED_METHODS as readonly string[]).some(
    (token) => token.toLowerCase() === m,
  );
}
