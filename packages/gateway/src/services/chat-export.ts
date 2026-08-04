/**
 * Pure markdown export of a chat event stream (user/assistant text).
 * Thread membership + output path helpers keep Gateway dispatch thin (Phase 6).
 */

export interface ExportEvent {
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ThreadTaskLike {
  id: string;
  parentTaskId: string | null;
  createdAt: string;
  title?: string | null;
  goal: string;
  policySnapshot?: { workspaceRoots?: string[] };
}

/**
 * Walk parent chain to the root task of a chat thread.
 */
export function resolveChatRootTask<T extends ThreadTaskLike>(
  start: T,
  getById: (id: string) => T | null | undefined,
): T {
  let root = start;
  while (root.parentTaskId) {
    const p = getById(root.parentTaskId);
    if (!p) break;
    root = p;
  }
  return root;
}

/**
 * Full descendant closure under root (BFS), sorted by createdAt.
 */
export function collectChatThreadMembers<T extends ThreadTaskLike>(
  root: T,
  all: T[],
): T[] {
  const byParent = new Map<string | null, T[]>();
  for (const t of all) {
    const key = t.parentTaskId;
    const list = byParent.get(key) ?? [];
    list.push(t);
    byParent.set(key, list);
  }
  const members: T[] = [];
  const queue = [root.id];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = all.find((t) => t.id === id);
    if (node) members.push(node);
    for (const child of byParent.get(id) ?? []) {
      queue.push(child.id);
    }
  }
  members.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return members;
}

/**
 * Safe export filename stem from title (filesystem-friendly, bounded).
 */
export function safeChatExportStem(title: string | null | undefined): string {
  return (title || "chat").replace(/[^\w\-]+/g, "_").slice(0, 40);
}

/**
 * Choose exports directory: workspaceRoots[0]/exports when present on disk,
 * else dataDir/exports.
 */
export function resolveChatExportDir(input: {
  workspaceRoots: string[] | undefined | null;
  dataDir: string;
  existsSync: (p: string) => boolean;
  join: (...parts: string[]) => string;
}): string {
  const root0 = input.workspaceRoots?.[0];
  if (root0 && input.existsSync(root0)) {
    return input.join(root0, "exports");
  }
  return input.join(input.dataDir, "exports");
}

export function eventsToMarkdown(opts: {
  title: string;
  goal: string;
  events: ExportEvent[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${opts.title || "Chat"}`);
  lines.push("");
  if (opts.goal) {
    lines.push(`**Goal:** ${opts.goal}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  for (const ev of opts.events) {
    const p = ev.payload ?? {};
    const typ = String(ev.type || "").toLowerCase();

    // Engine message shape stored by gateway
    if (typ === "message" || typ === "user" || typ === "assistant") {
      const role = String(p.role ?? (typ === "user" ? "user" : "assistant"));
      const channel = String(p.channel ?? "text");
      if (channel === "thought") continue;
      const text = String(p.text ?? p.content ?? "").trim();
      if (!text) continue;
      const who = role === "user" ? "User" : "Assistant";
      lines.push(`### ${who}`);
      lines.push("");
      lines.push(text);
      lines.push("");
      continue;
    }

    // Stream view / desk shapes
    if (typ === "goal" || typ === "user_goal") {
      const text = String(p.text ?? p.goal ?? "").trim();
      if (text) {
        lines.push(`### User`);
        lines.push("");
        lines.push(text);
        lines.push("");
      }
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
