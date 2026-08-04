/**
 * Pure Home draft / pending-submit hydration (Task 12).
 * Call once before the Home composer becomes interactive.
 */
import type { PendingMutationRecord } from "./client-mutation";
import {
  resolveResumeIntent,
  type WorkSessionSnapshot,
} from "./work-session";

export type HomeDraftHydration = {
  goal: string;
  /** Workspace root to seed; null means keep App's existing root seed. */
  root: string | null;
  /** Attachment source paths restored from session (best-effort). */
  attachmentPaths: string[];
  pendingMutation: PendingMutationRecord | null;
  /** One-shot "Draft restored" status after hydrate. */
  showDraftRestored: boolean;
  /** Optional conversation to focus after boot. */
  resumeConversationId: string | null;
};

const ATTACH_PATH_MAX = 10;
const PATH_MAX = 4096;

/**
 * Plan Home composer state from durable session + pending mutation storage.
 * Does not write storage or toast — pure.
 */
export function planHomeDraftHydration(input: {
  session: WorkSessionSnapshot;
  pendingMutation?: PendingMutationRecord | null;
  /** Fallback when session has no workspaceRoot. */
  lastWorkspaceRoot?: string | null;
  now?: Date;
}): HomeDraftHydration {
  const now = input.now ?? new Date();
  const pending = input.pendingMutation ?? null;
  const intent = resolveResumeIntent(input.session, now);

  const attachmentPaths = normalizeAttachmentPaths(
    input.session.attachmentPaths,
  );

  if (intent.type === "restore_home_draft") {
    return {
      goal: intent.draft,
      root: intent.workspaceRoot ?? input.lastWorkspaceRoot ?? null,
      attachmentPaths,
      pendingMutation: pending,
      showDraftRestored: intent.draft.trim().length > 0,
      resumeConversationId: null,
    };
  }

  if (intent.type === "open_conversation") {
    return {
      goal: intent.draft,
      root: input.session.workspaceRoot ?? input.lastWorkspaceRoot ?? null,
      attachmentPaths,
      pendingMutation: pending,
      showDraftRestored: intent.draft.trim().length > 0,
      resumeConversationId: intent.conversationId,
    };
  }

  // Explicit empty / no resume — do not resurrect stale drafts.
  return {
    goal: "",
    root: input.lastWorkspaceRoot ?? null,
    attachmentPaths: [],
    pendingMutation: pending,
    showDraftRestored: false,
    resumeConversationId: null,
  };
}

function normalizeAttachmentPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== "string" || !p.trim()) continue;
    out.push(p.trim().slice(0, PATH_MAX));
    if (out.length >= ATTACH_PATH_MAX) break;
  }
  return out;
}

/**
 * Whether Home create should be blocked because a pending root submit is
 * still reconciling (exact mutation id + payload must be used first).
 */
export function shouldBlockNewRootSubmit(
  pending: PendingMutationRecord | null | undefined,
): boolean {
  return Boolean(
    pending &&
      pending.method === "tasks.create" &&
      pending.clientMutationId &&
      pending.payload &&
      typeof pending.payload === "object",
  );
}
