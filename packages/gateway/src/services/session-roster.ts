/**
 * Desk conversation search, ACP-shaped roster hits, and foreign-session scan.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  claudeProjectDirName,
  finishForeignScan,
  listDeskConversations,
  searchDeskConversations,
  type DeskConversationRow,
  type ForeignFileEntry,
  type ForeignSessionSummary,
  type SessionHeadlessPolicy,
  type SessionSearchHit,
  type SessionSearchView,
  SESSION_HEADLESS_DEFAULT,
} from "@grokdesk/shared";
import type { Task } from "@grokdesk/shared";

const HEAD_BYTES = 8 * 1024;

function isUnderRoot(
  task: Task,
  rootId: string,
  byId: Map<string, Task>,
): boolean {
  let cur: Task | undefined = task;
  const seen = new Set<string>();
  while (cur) {
    if (cur.id === rootId) return true;
    if (seen.has(cur.id)) return false;
    seen.add(cur.id);
    cur = cur.parentTaskId ? byId.get(cur.parentTaskId) : undefined;
  }
  return false;
}

function latestMember(
  root: Task,
  all: Task[],
  byId: Map<string, Task>,
): Task {
  let latest = root;
  for (const t of all) {
    if (!isUnderRoot(t, root.id, byId)) continue;
    if (
      t.updatedAt > latest.updatedAt ||
      (t.updatedAt === latest.updatedAt && t.createdAt > latest.createdAt)
    ) {
      latest = t;
    }
  }
  return latest;
}

function deskRowsFromTasks(
  tasks: Task[],
  needsInputIds?: Set<string>,
): DeskConversationRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const roots = tasks.filter((t) => !t.parentTaskId);
  return roots.map((root) => {
    const latest = latestMember(root, tasks, byId);
    return {
      id: root.id,
      title: root.title,
      goal: root.goal,
      status: latest.status,
      needsInput:
        needsInputIds?.has(root.id) === true ||
        needsInputIds?.has(latest.id) === true,
      updatedAt:
        latest.updatedAt > root.updatedAt ? latest.updatedAt : root.updatedAt,
      lastTurnSummary: latest.goal,
    };
  });
}

export function deskHitsFromTasks(
  tasks: Task[],
  query: string,
  needsInputIds?: Set<string>,
): SessionSearchHit[] {
  return searchDeskConversations(
    deskRowsFromTasks(tasks, needsInputIds),
    query,
  );
}

export function rosterHitsFromTasks(
  tasks: Task[],
  needsInputIds?: Set<string>,
): SessionSearchHit[] {
  return listDeskConversations(deskRowsFromTasks(tasks, needsInputIds));
}

function readHead(filePath: string): string {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
      return buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function listJsonl(dir: string, tool: ForeignFileEntry["tool"]): ForeignFileEntry[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: ForeignFileEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl") && !name.endsWith(".json")) continue;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size <= 0) continue;
    const nativeId = name.replace(/\.(jsonl|json)$/i, "");
    if (!nativeId) continue;
    out.push({
      tool,
      path: full,
      nativeId,
      mtimeMs: st.mtimeMs,
      head: readHead(full),
    });
  }
  return out;
}

function walkJsonl(
  dir: string,
  tool: ForeignFileEntry["tool"],
  depth = 0,
): ForeignFileEntry[] {
  if (depth > 3) return [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: ForeignFileEntry[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      out.push(...walkJsonl(full, tool, depth + 1));
    } else if (st.isFile() && (name.endsWith(".jsonl") || name.endsWith(".json"))) {
      const nativeId = name.replace(/\.(jsonl|json)$/i, "");
      if (!nativeId) continue;
      out.push({
        tool,
        path: full,
        nativeId,
        mtimeMs: st.mtimeMs,
        head: readHead(full),
      });
    }
  }
  return out;
}

export function scanForeignSessionsFromHome(opts: {
  homeDir?: string;
  cwd?: string | null;
  nowMs?: number;
}): ForeignSessionSummary[] {
  const home = opts.homeDir ?? os.homedir();
  const entries: ForeignFileEntry[] = [];
  const claudeRoot = path.join(home, ".claude", "projects");
  if (opts.cwd) {
    entries.push(
      ...listJsonl(
        path.join(claudeRoot, claudeProjectDirName(opts.cwd)),
        "claude",
      ),
    );
  } else {
    try {
      for (const name of fs.readdirSync(claudeRoot)) {
        entries.push(
          ...listJsonl(path.join(claudeRoot, name), "claude"),
        );
      }
    } catch {
      /* missing */
    }
  }
  entries.push(...walkJsonl(path.join(home, ".codex", "sessions"), "codex"));
  entries.push(...walkJsonl(path.join(home, ".cursor", "chats"), "cursor"));
  entries.push(...walkJsonl(path.join(home, ".cursor", "projects"), "cursor"));
  return finishForeignScan(entries, {
    nowMs: opts.nowMs,
    cwd: opts.cwd ?? null,
  });
}

export function buildSessionSearchView(input: {
  deskHits: SessionSearchHit[];
  acp?: SessionSearchView | null;
  headless?: SessionHeadlessPolicy;
}): SessionSearchView {
  const headless = input.headless ?? SESSION_HEADLESS_DEFAULT;
  const seen = new Set<string>();
  const hits: SessionSearchHit[] = [];
  for (const hit of [
    ...input.deskHits,
    ...(input.acp?.hits ?? []),
  ]) {
    if (seen.has(hit.sessionId)) continue;
    seen.add(hit.sessionId);
    hits.push(hit);
  }
  return {
    status: input.acp?.status === "bootstrapping" ? "bootstrapping" : "ready",
    headless,
    hits,
  };
}
