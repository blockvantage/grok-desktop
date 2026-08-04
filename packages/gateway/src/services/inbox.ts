import { randomUUID } from "node:crypto";
import type { InboxItem, InboxKind } from "@grokdesk/shared";
import type { Db } from "../db.js";

export type InboxServiceHooks = {
  onInboxChanged?: () => void;
};

export class InboxService {
  constructor(
    private db: Db,
    private hooks: InboxServiceHooks = {},
  ) {
    // Retention sweep on startup so unbounded growth cannot survive restarts.
    this.prune();
  }

  list(limit = 200): InboxItem[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM inbox_items ORDER BY created_at DESC LIMIT ?`,
      )
      .all(lim) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as InboxKind,
      title: r.title as string,
      body: r.body as string,
      taskId: (r.task_id as string | null) ?? null,
      read: Boolean(r.read),
      createdAt: r.created_at as string,
    }));
  }

  add(input: {
    kind: InboxKind;
    title: string;
    body: string;
    taskId?: string | null;
  }): InboxItem {
    const item: InboxItem = {
      id: randomUUID(),
      kind: input.kind,
      title: input.title,
      body: input.body,
      taskId: input.taskId ?? null,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO inbox_items (id, kind, title, body, task_id, read, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        item.id,
        item.kind,
        item.title,
        item.body,
        item.taskId,
        item.createdAt,
      );
    this.hooks.onInboxChanged?.();
    return item;
  }

  markRead(id: string): void {
    this.db.prepare(`UPDATE inbox_items SET read = 1 WHERE id = ?`).run(id);
    this.hooks.onInboxChanged?.();
  }

  /** Dismiss (delete) an inbox item permanently. */
  dismiss(id: string): void {
    this.db.prepare(`DELETE FROM inbox_items WHERE id = ?`).run(id);
    this.hooks.onInboxChanged?.();
  }

  /**
   * Dedupe suggestions forever until dismissed (by kind+taskId).
   * Other kinds still use a 24h window so genuine re-approvals can re-notify.
   */
  addDeduped(input: {
    kind: InboxKind;
    title: string;
    body: string;
    taskId?: string | null;
  }): InboxItem | null {
    if (input.kind === "suggestion") {
      const existing = this.db
        .prepare(
          `SELECT id FROM inbox_items WHERE kind = ? AND IFNULL(task_id,'') = IFNULL(?, '') LIMIT 1`,
        )
        .get(input.kind, input.taskId ?? null) as { id: string } | undefined;
      if (existing) return null;
      return this.add(input);
    }
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const existing = this.db
      .prepare(
        `SELECT id FROM inbox_items WHERE kind = ? AND IFNULL(task_id,'') = IFNULL(?, '') AND created_at >= ? LIMIT 1`,
      )
      .get(input.kind, input.taskId ?? null, since) as { id: string } | undefined;
    if (existing) return null;
    return this.add(input);
  }

  /**
   * Retention: delete items that are read (or already dismissed via DELETE)
   * and older than maxAgeDays. Also enforce a hard cap so unread spam cannot
   * grow SQLite without bound (drop oldest first).
   * Columns: read (INTEGER), created_at (TEXT ISO).
   */
  prune(maxAgeDays = 30, maxItems = 500): number {
    const cutoff = new Date(
      Date.now() - maxAgeDays * 24 * 3600_000,
    ).toISOString();
    const r = this.db
      .prepare(
        `DELETE FROM inbox_items WHERE read = 1 AND created_at < ?`,
      )
      .run(cutoff);
    let changes = r.changes ?? 0;
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as c FROM inbox_items`)
      .get() as { c: number };
    const excess = Number(countRow?.c ?? 0) - maxItems;
    if (excess > 0) {
      const cap = this.db
        .prepare(
          `DELETE FROM inbox_items WHERE id IN (
             SELECT id FROM inbox_items ORDER BY created_at ASC LIMIT ?
           )`,
        )
        .run(excess);
      changes += cap.changes ?? 0;
    }
    return changes;
  }
}
