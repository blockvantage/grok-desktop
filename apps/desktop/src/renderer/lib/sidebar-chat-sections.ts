/**
 * Partition sidebar chats so daily navigation stays focused on meaningful work.
 * Failed/cancelled history moves under a secondary "Needs review" band.
 * Retry-heavy duplicate titles are collapsed so history noise doesn't dominate.
 * Full history remains available via Chats/Tasks (See all).
 */

import { isActiveTaskStatus } from "@grokdesk/shared";

export type SidebarChatLike = {
  id: string;
  updatedAt: string;
  latest: { status: string };
  /** Optional pin: pinned chats stay in primary even if failed. */
  pinned?: boolean;
  /** Display title — used to collapse retry duplicates. */
  title?: string;
  /** Waiting-on-you projector: this chat needs a human reply/approval. */
  needsInput?: boolean;
};

/** Default primary rows shown in the sidebar (full list is Chats view). */
export const SIDEBAR_MAX_PRIMARY = 24;

/** Cap Needs review so retry spam never floods the rail. */
export const SIDEBAR_MAX_NEEDS_REVIEW = 12;

/** Terminal outcomes that should not dominate daily sidebar navigation. */
export function isNeedsReviewStatus(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/**
 * Normalize chat title for retry/duplicate clustering.
 * Empty titles do not collapse together (each empty-title chat stays unique).
 */
export function normalizeSidebarTitle(title: string | undefined): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.…]+$/g, "")
    .trim();
}

/**
 * Collapse duplicate titles: keep most-recent per key (input newest-first).
 * Pinned and active chats always kept so live work never disappears.
 */
export function collapseDuplicateTitles<T extends SidebarChatLike>(
  chats: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const chat of chats) {
    const key = normalizeSidebarTitle(chat.title);
    if (chat.pinned || chat.needsInput || isActiveTaskStatus(chat.latest.status)) {
      out.push(chat);
      if (key) seen.add(key);
      continue;
    }
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(chat);
  }
  return out;
}

/**
 * Active + pinned first (preserving relative recency), then the rest.
 * Keeps live work at the top of daily navigation.
 */
export function prioritizePrimaryChats<T extends SidebarChatLike>(
  chats: T[],
): T[] {
  const priority: T[] = [];
  const rest: T[] = [];
  for (const c of chats) {
    if (c.pinned || c.needsInput || isActiveTaskStatus(c.latest.status))
      priority.push(c);
    else rest.push(c);
  }
  return [...priority, ...rest];
}

/**
 * Split chats into primary (active/recent meaningful) vs needs-review (failed history).
 * Dedupes retry titles, prioritizes active work, and caps list lengths.
 * Overflow is intentional — open Chats/Tasks for full history.
 */
export function partitionSidebarChats<T extends SidebarChatLike>(
  chats: T[],
  opts?: { maxPrimary?: number; maxNeedsReview?: number },
): { primary: T[]; needsReview: T[] } {
  const maxPrimary = opts?.maxPrimary ?? SIDEBAR_MAX_PRIMARY;
  const maxNeedsReview = opts?.maxNeedsReview ?? SIDEBAR_MAX_NEEDS_REVIEW;

  const primaryRaw: T[] = [];
  const needsReviewRaw: T[] = [];

  for (const chat of chats) {
    const status = chat.latest.status;
    if (
      chat.pinned ||
      chat.needsInput ||
      isActiveTaskStatus(status) ||
      !isNeedsReviewStatus(status)
    ) {
      primaryRaw.push(chat);
    } else {
      needsReviewRaw.push(chat);
    }
  }

  let primary = prioritizePrimaryChats(collapseDuplicateTitles(primaryRaw));
  let needsReview = collapseDuplicateTitles(needsReviewRaw);

  if (primary.length > maxPrimary) {
    const actives = primary.filter(
      (c) => c.pinned || c.needsInput || isActiveTaskStatus(c.latest.status),
    );
    const rest = primary.filter(
      (c) =>
        !c.pinned && !c.needsInput && !isActiveTaskStatus(c.latest.status),
    );
    primary = [...actives, ...rest].slice(0, maxPrimary);
  }

  if (needsReview.length > maxNeedsReview) {
    needsReview = needsReview.slice(0, maxNeedsReview);
  }

  return { primary, needsReview };
}

/**
 * Within a folder group, apply the same partition so failed rows are not
 * interleaved with active/recent success paths.
 */
export function partitionFolderChats<T extends SidebarChatLike>(
  chats: T[],
): { primary: T[]; needsReview: T[] } {
  return partitionSidebarChats(chats, {
    maxPrimary: 200,
    maxNeedsReview: 50,
  });
}
