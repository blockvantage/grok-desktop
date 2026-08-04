/**
 * Per-task follow-up composer drafts (CHAT-2).
 * Survives navigation and app restart via localStorage.
 */

export const FOLLOW_UP_DRAFTS_KEY = "grokdesk.followUpDrafts.v1";

/** Prune drafts older than this on every load/save. */
export const FOLLOW_UP_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type FollowUpDraft = {
  text: string;
  attachmentPaths: string[];
  /** ISO timestamp of last write. */
  updatedAt: string;
};

export type FollowUpDraftsMap = Record<string, FollowUpDraft>;

export function emptyFollowUpDrafts(): FollowUpDraftsMap {
  return {};
}

function isDraft(value: unknown): value is FollowUpDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<FollowUpDraft>;
  return (
    typeof d.text === "string" &&
    Array.isArray(d.attachmentPaths) &&
    d.attachmentPaths.every((p) => typeof p === "string") &&
    typeof d.updatedAt === "string"
  );
}

/** Drop entries older than maxAge (default 14 days). Pure map op. */
export function pruneFollowUpDrafts(
  map: FollowUpDraftsMap,
  nowMs = Date.now(),
  maxAgeMs = FOLLOW_UP_DRAFT_MAX_AGE_MS,
): FollowUpDraftsMap {
  const next: FollowUpDraftsMap = {};
  for (const [taskId, draft] of Object.entries(map)) {
    const updated = Date.parse(draft.updatedAt);
    if (!Number.isFinite(updated)) continue;
    if (nowMs - updated > maxAgeMs) continue;
    next[taskId] = draft;
  }
  return next;
}

const DRAFT_MAX_TASKS = 100;
const DRAFT_MAX_TEXT = 32_000;
const DRAFT_MAX_PATHS = 10;

export function loadFollowUpDrafts(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
  nowMs = Date.now(),
): FollowUpDraftsMap {
  if (!storage) return emptyFollowUpDrafts();
  try {
    const raw = storage.getItem(FOLLOW_UP_DRAFTS_KEY);
    if (!raw) return emptyFollowUpDrafts();
    if (raw.length > 1_000_000) return emptyFollowUpDrafts();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyFollowUpDrafts();
    }
    const map: FollowUpDraftsMap = {};
    let count = 0;
    for (const [taskId, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (count >= DRAFT_MAX_TASKS) break;
      if (typeof taskId !== "string" || !taskId || taskId.length > 128) continue;
      if (!isDraft(value)) continue;
      map[taskId] = {
        text: value.text.slice(0, DRAFT_MAX_TEXT),
        attachmentPaths: value.attachmentPaths
          .filter((p) => typeof p === "string" && p.length > 0)
          .map((p) => p.slice(0, 4096))
          .slice(0, DRAFT_MAX_PATHS),
        updatedAt: value.updatedAt,
      };
      count += 1;
    }
    return pruneFollowUpDrafts(map, nowMs);
  } catch {
    return emptyFollowUpDrafts();
  }
}

export function saveFollowUpDrafts(
  map: FollowUpDraftsMap,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
  nowMs = Date.now(),
): void {
  if (!storage) return;
  try {
    const pruned = pruneFollowUpDrafts(map, nowMs);
    storage.setItem(FOLLOW_UP_DRAFTS_KEY, JSON.stringify(pruned));
  } catch {
    /* quota / private mode */
  }
}

export function loadFollowUpDraft(
  taskId: string,
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
  nowMs = Date.now(),
): FollowUpDraft | null {
  if (!taskId) return null;
  const map = loadFollowUpDrafts(storage, nowMs);
  return map[taskId] ?? null;
}

export function saveFollowUpDraft(
  taskId: string,
  draft: { text: string; attachmentPaths?: string[] },
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
  nowMs = Date.now(),
): void {
  if (!taskId || !storage) return;
  const text = draft.text;
  const attachmentPaths = draft.attachmentPaths ?? [];
  // Empty draft → clear the slot (no noise for blank composers).
  if (!text.trim() && attachmentPaths.length === 0) {
    clearFollowUpDraft(taskId, storage, nowMs);
    return;
  }
  const map = loadFollowUpDrafts(storage, nowMs);
  map[taskId] = {
    text,
    attachmentPaths: [...attachmentPaths],
    updatedAt: new Date(nowMs).toISOString(),
  };
  saveFollowUpDrafts(map, storage, nowMs);
}

export function clearFollowUpDraft(
  taskId: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
  nowMs = Date.now(),
): void {
  if (!taskId || !storage) return;
  const map = loadFollowUpDrafts(storage, nowMs);
  if (!(taskId in map)) return;
  delete map[taskId];
  saveFollowUpDrafts(map, storage, nowMs);
}
