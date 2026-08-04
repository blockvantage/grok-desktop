import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { InboxService } from "./inbox.js";

describe("InboxService prune", () => {
  let dir: string;
  let db: Db;
  let inbox: InboxService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-inbox-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    inbox = new InboxService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("prunes old read items; keeps fresh unread", () => {
    const oldRead = inbox.add({
      kind: "approval",
      title: "Old read",
      body: "gone soon",
      taskId: "t-old",
    });
    const freshUnread = inbox.add({
      kind: "approval",
      title: "Fresh unread",
      body: "keep me",
      taskId: "t-fresh",
    });
    inbox.markRead(oldRead.id);

    // Backdate the old read item past retention.
    const oldIso = new Date(Date.now() - 40 * 24 * 3600_000).toISOString();
    db.prepare(`UPDATE inbox_items SET created_at = ? WHERE id = ?`).run(
      oldIso,
      oldRead.id,
    );

    const removed = inbox.prune(30);
    expect(removed).toBe(1);

    const remaining = inbox.list();
    expect(remaining.map((i) => i.id)).toContain(freshUnread.id);
    expect(remaining.map((i) => i.id)).not.toContain(oldRead.id);
  });

  it("caps total inbox size by dropping oldest rows", () => {
    for (let i = 0; i < 10; i++) {
      inbox.add({
        kind: "unfinished",
        title: `item ${i}`,
        body: "x",
        taskId: `t-${i}`,
      });
    }
    const removed = inbox.prune(30, 5);
    expect(removed).toBeGreaterThanOrEqual(5);
    expect(inbox.list()).toHaveLength(5);
  });
});
