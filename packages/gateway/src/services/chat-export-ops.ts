/**
 * Orchestrate chats.exportMarkdown: thread membership → markdown → disk write.
 * Phase 6 extract from Gateway dispatch.
 */
import fs from "node:fs";
import path from "node:path";
import type { Task } from "@grokdesk/shared";
import {
  collectChatThreadMembers,
  eventsToMarkdown,
  resolveChatExportDir,
  resolveChatRootTask,
  safeChatExportStem,
  type ExportEvent,
} from "./chat-export.js";

export interface ChatExportEventRow {
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
  /** Required for pagination; without seq the export stops after first page. */
  seq?: number;
}

export interface ChatExportOpsDeps {
  getTask(id: string): Task | null | undefined;
  listTasks(): Task[];
  listEvents(taskId: string, afterSeq: number): ChatExportEventRow[];
  dataDir: string;
  existsSync?: (p: string) => boolean;
  mkdirSync?: (p: string, opts: { recursive: boolean }) => void;
  writeFileSync?: (p: string, data: string, enc: string) => void;
  join?: (...parts: string[]) => string;
}

/** Soft cap on export pages per thread member (500 events each). */
export const CHAT_EXPORT_MAX_PAGES = 50;

export function exportChatMarkdown(
  taskId: string,
  deps: ChatExportOpsDeps,
): { path: string; markdown: string } {
  const start = deps.getTask(taskId);
  if (!start) throw new Error("Task not found");

  const existsSync = deps.existsSync ?? fs.existsSync;
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
  const writeFileSync = deps.writeFileSync ?? fs.writeFileSync;
  const join = deps.join ?? path.join;

  const rootTask = resolveChatRootTask(start, (id) => deps.getTask(id));
  const members = collectChatThreadMembers(rootTask, deps.listTasks());
  const events: ExportEvent[] = members.flatMap((t) => {
    const out: ExportEvent[] = [];
    let after = 0;
    for (let page = 0; page < CHAT_EXPORT_MAX_PAGES; page++) {
      const batch = deps.listEvents(t.id, after);
      if (!batch.length) break;
      let pageMaxSeq = after;
      for (const e of batch) {
        out.push({
          type: e.kind,
          payload: e.payload,
          createdAt: e.createdAt,
        });
        if (typeof e.seq === "number" && Number.isFinite(e.seq)) {
          pageMaxSeq = Math.max(pageMaxSeq, e.seq);
        }
      }
      // Without advancing seq, further pages would re-fetch the same window.
      if (pageMaxSeq <= after) break;
      after = pageMaxSeq;
      if (batch.length < 500) break;
    }
    return out;
  });
  const markdown = eventsToMarkdown({
    title: rootTask.title || rootTask.goal.slice(0, 80),
    goal: rootTask.goal,
    events,
  });
  const outDir = resolveChatExportDir({
    workspaceRoots: rootTask.policySnapshot.workspaceRoots,
    dataDir: deps.dataDir,
    existsSync,
    join,
  });
  mkdirSync(outDir, { recursive: true });
  const filePath = join(
    outDir,
    `${safeChatExportStem(rootTask.title)}-${rootTask.id.slice(0, 8)}.md`,
  );
  writeFileSync(filePath, markdown, "utf8");
  return { path: filePath, markdown };
}
