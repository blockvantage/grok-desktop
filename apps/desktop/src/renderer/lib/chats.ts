import type { Task } from "@grokdesk/shared";
import { t } from "@/i18n/active";

/**
 * A chat is one conversation: a root task plus every follow-up turn chained to
 * it via parentTaskId. The sidebar shows one row per chat; opening it shows all
 * turns in order.
 */
export type Chat = {
  /** Root task id — the stable chat id. */
  id: string;
  root: Task;
  /** Turns oldest → newest, including the root. */
  turns: Task[];
  /** Newest turn — the active one for live updates / follow-ups. */
  latest: Task;
  /** Display title (Grok-generated, or derived from the goal). */
  title: string;
  /** Most recent updatedAt across all turns, for recency ordering. */
  updatedAt: string;
};

/** Walk parentTaskId up to the thread root (guards against cycles). */
function rootIdOf(task: Task, byId: Map<string, Task>): string {
  let cur = task;
  const seen = new Set<string>();
  while (cur.parentTaskId && byId.has(cur.parentTaskId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentTaskId)!;
  }
  return cur.id;
}

/** Group a flat task list into chats, newest chat first. */
export function buildChats(tasks: Task[]): Chat[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const rid = rootIdOf(t, byId);
    const arr = groups.get(rid);
    if (arr) arr.push(t);
    else groups.set(rid, [t]);
  }

  const chats: Chat[] = [];
  for (const [rid, members] of groups) {
    const turns = [...members].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const root = byId.get(rid) ?? turns[0]!;
    const latest = turns[turns.length - 1]!;
    const updatedAt = turns.reduce(
      (m, t) => (t.updatedAt > m ? t.updatedAt : m),
      turns[0]!.updatedAt,
    );
    chats.push({
      id: rid,
      root,
      turns,
      latest,
      title: chatTitle(root),
      updatedAt,
    });
  }
  chats.sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
  );
  return chats;
}

/**
 * A chat's display title.
 * Prefer Grok-generated title. Until it arrives, show a useful derived title
 * from the goal immediately (not a permanent "New chat" during active work).
 */
export function chatTitle(root: Task): string {
  const stored = root.title?.trim();
  if (stored && stored.length > 0) return stored;
  const derived = deriveTitle(root.goal);
  if (derived && derived !== t("common.newChat")) return derived;
  return t("common.newChat");
}

/**
 * Concise fallback title from a raw goal for list scanning (Task 15).
 * Caps length; full goal stays available via tooltip/aria elsewhere.
 */
export function deriveTitle(goal: string): string {
  const clean = goal.replace(/\s+/g, " ").trim();
  if (!clean) return t("common.newChat");
  const firstLine = clean.split(/\n/)[0]?.trim() ?? clean;
  const firstSentence = firstLine.split(/(?<=[.!?…])\s/u)[0] ?? firstLine;
  const base = firstSentence.length <= 48 ? firstSentence : firstLine;
  if (base.length <= 48) {
    // Light English-ish polish only when the string is ASCII-heavy; leave
    // non-Latin / emoji goals intact for scanning.
    if (/^[\x00-\x7F]+$/.test(base)) {
      const words = base
        .split(" ")
        .slice(0, 8)
        .join(" ")
        .replace(/[.,;:]+$/, "");
      if (!words) return t("common.newChat");
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
    return base;
  }
  return `${base.slice(0, 47).trimEnd()}…`;
}

/** The chat that contains a given task id, if any. */
export function findChat(chats: Chat[], taskId: string | null): Chat | null {
  if (!taskId) return null;
  return chats.find((c) => c.turns.some((t) => t.id === taskId)) ?? null;
}
