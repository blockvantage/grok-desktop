/**
 * Work session resume — last open conversation + composer draft continuity.
 */

const STORAGE_KEY = "grokdesk.work-session.v1";

export type WorkSessionSnapshot = {
  /** Last focused chat / root task id. */
  conversationId: string | null;
  /** Composer draft text (home or follow-up). */
  draft: string;
  /** Which surface owned the draft. */
  surface: "home" | "workspace";
  /** ISO timestamp of last write. */
  updatedAt: string;
  /** Optional workspace root associated with the draft. */
  workspaceRoot?: string | null;
  /**
   * Home attachment source paths (best-effort restore).
   * Empty array is intentional clear; omit/undefined means unknown/legacy.
   */
  attachmentPaths?: string[];
  /**
   * True when the user deliberately cleared the Home draft.
   * Prevents resurrection of older drafts after empty-draft persist.
   */
  draftCleared?: boolean;
};

export function emptyWorkSession(): WorkSessionSnapshot {
  return {
    conversationId: null,
    draft: "",
    surface: "home",
    updatedAt: new Date(0).toISOString(),
    workspaceRoot: null,
    attachmentPaths: [],
    draftCleared: false,
  };
}

const DRAFT_MAX = 32_000;
const ID_MAX = 128;
const PATH_MAX = 4096;
const ATTACH_MAX = 10;

export function loadWorkSession(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): WorkSessionSnapshot {
  if (!storage) return emptyWorkSession();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyWorkSession();
    if (raw.length > 200_000) return emptyWorkSession();
    const parsed = JSON.parse(raw) as Partial<WorkSessionSnapshot>;
    const attachmentPaths = Array.isArray(parsed.attachmentPaths)
      ? parsed.attachmentPaths
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .map((p) => p.slice(0, PATH_MAX))
          .slice(0, ATTACH_MAX)
      : [];
    return {
      conversationId:
        typeof parsed.conversationId === "string"
          ? parsed.conversationId.slice(0, ID_MAX)
          : null,
      draft:
        typeof parsed.draft === "string"
          ? parsed.draft.slice(0, DRAFT_MAX)
          : "",
      surface: parsed.surface === "workspace" ? "workspace" : "home",
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt.slice(0, 64)
          : new Date(0).toISOString(),
      workspaceRoot:
        typeof parsed.workspaceRoot === "string"
          ? parsed.workspaceRoot.slice(0, PATH_MAX)
          : null,
      attachmentPaths,
      draftCleared: parsed.draftCleared === true,
    };
  } catch {
    return emptyWorkSession();
  }
}

export function saveWorkSession(
  session: WorkSessionSnapshot,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* */
  }
}

export function touchWorkSession(
  prev: WorkSessionSnapshot,
  patch: Partial<WorkSessionSnapshot>,
  now = new Date().toISOString(),
): WorkSessionSnapshot {
  return {
    ...prev,
    ...patch,
    updatedAt: now,
  };
}

/**
 * Whether we should offer "Resume where you left off" on Home.
 * Draft must be non-trivial or conversation focused within 7 days.
 */
export function shouldOfferResume(
  session: WorkSessionSnapshot,
  now = new Date(),
): boolean {
  // User deliberately cleared the Home draft — do not resurrect draft text.
  if (session.draftCleared && !session.draft.trim()) {
    return Boolean(session.conversationId);
  }
  const hasDraft = session.draft.trim().length >= 8;
  const hasConv = Boolean(session.conversationId);
  if (!hasDraft && !hasConv) return false;
  const updated = Date.parse(session.updatedAt);
  if (!Number.isFinite(updated)) return hasDraft;
  const ageMs = now.getTime() - updated;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return ageMs >= 0 && ageMs <= sevenDays;
}

export type ResumeIntent =
  | { type: "open_conversation"; conversationId: string; draft: string }
  | { type: "restore_home_draft"; draft: string; workspaceRoot: string | null }
  | { type: "none" };

export function resolveResumeIntent(
  session: WorkSessionSnapshot,
  now = new Date(),
): ResumeIntent {
  if (!shouldOfferResume(session, now)) return { type: "none" };
  if (session.surface === "workspace" && session.conversationId) {
    return {
      type: "open_conversation",
      conversationId: session.conversationId,
      draft: session.draft,
    };
  }
  if (session.draft.trim()) {
    return {
      type: "restore_home_draft",
      draft: session.draft,
      workspaceRoot: session.workspaceRoot ?? null,
    };
  }
  if (session.conversationId) {
    return {
      type: "open_conversation",
      conversationId: session.conversationId,
      draft: "",
    };
  }
  return { type: "none" };
}

export { STORAGE_KEY as WORK_SESSION_KEY };
