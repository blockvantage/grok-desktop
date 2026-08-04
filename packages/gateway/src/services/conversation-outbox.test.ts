import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import {
  ConversationOutboxRepository,
  OUTBOX_MAX_PENDING_PER_CONVERSATION,
  OUTBOX_MAX_PENDING_TOTAL,
  OUTBOX_CLAIM_LEASE_MS,
} from "./conversation-outbox.js";

function attachment(id = "a1") {
  return {
    id,
    name: "note.txt",
    sourcePath: "/tmp/note.txt",
    kind: "file" as const,
  };
}

describe("ConversationOutboxRepository", () => {
  let dir: string;
  let db: Db;
  let repo: ConversationOutboxRepository;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-outbox-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
    repo = new ConversationOutboxRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("enqueues FIFO with positions and isolates conversations", () => {
    const a1 = repo.enqueue({
      id: "m1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "first",
      attachments: [],
    });
    const a2 = repo.enqueue({
      id: "m2",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "second",
      attachments: [],
    });
    const b1 = repo.enqueue({
      id: "m3",
      conversationId: "c2",
      parentTaskId: "t2",
      text: "other",
      attachments: [],
    });
    expect(a1.outcome).toBe("accepted");
    expect(a2.outcome).toBe("accepted");
    expect(b1.outcome).toBe("accepted");
    if (a1.outcome !== "accepted" || a2.outcome !== "accepted") return;

    const list = repo.list({ conversationId: "c1" });
    expect(list.map((i) => i.id)).toEqual(["m1", "m2"]);
    expect(list[0]!.position).toBe(1);
    expect(list[1]!.position).toBe(2);
    expect(repo.list({ conversationId: "c2" })).toHaveLength(1);
  });

  it("is idempotent for same id and payload; fails closed on payload clash", () => {
    const payload = {
      id: "same",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "hello",
      attachments: [attachment()],
    };
    const first = repo.enqueue(payload);
    const second = repo.enqueue(payload);
    expect(first.outcome).toBe("accepted");
    expect(second.outcome).toBe("accepted");
    if (first.outcome === "accepted" && second.outcome === "accepted") {
      expect(second.item.createdAt).toBe(first.item.createdAt);
    }
    expect(repo.list({ conversationId: "c1" })).toHaveLength(1);

    const clash = repo.enqueue({ ...payload, text: "different" });
    expect(clash.outcome).toBe("persistence_failed");
    expect(repo.list({ conversationId: "c1" })).toHaveLength(1);
  });

  it("returns full without deleting older rows when capacity is hit", () => {
    const limit = 3;
    // Temporary low-capacity exercise via direct inserts + repo count path:
    // fill to OUTBOX_MAX by stubbing count via many inserts with small override
    // is not available — instead assert production caps are positive and that
    // enqueue never deletes: insert up to a few and verify older remain after full.
    for (let i = 0; i < limit; i++) {
      const r = repo.enqueue({
        id: `cap-${i}`,
        conversationId: "c-full",
        parentTaskId: "t1",
        text: `msg ${i}`,
        attachments: [],
      });
      expect(r.outcome).toBe("accepted");
    }
    // Force capacity by filling per-conversation up to the real cap is heavy;
    // unit-test the capacity gate with a controlled partial fill + spy on count
    // by inserting rows with statuses that count toward active.
    const before = repo.list({ conversationId: "c-full" }).map((i) => i.id);
    expect(before).toEqual(["cap-0", "cap-1", "cap-2"]);

    // Drive the real capacity path: fill remaining slots until full.
    let fullSeen = false;
    for (let i = limit; i < OUTBOX_MAX_PENDING_PER_CONVERSATION + 5; i++) {
      const r = repo.enqueue({
        id: `cap-${i}`,
        conversationId: "c-full",
        parentTaskId: "t1",
        text: `msg ${i}`,
        attachments: [],
      });
      if (r.outcome === "full") {
        fullSeen = true;
        expect(r.limit).toBe(OUTBOX_MAX_PENDING_PER_CONVERSATION);
        break;
      }
      expect(r.outcome).toBe("accepted");
    }
    expect(fullSeen).toBe(true);
    // Oldest must still exist — never evicted.
    expect(repo.get("cap-0")?.text).toBe("msg 0");
    expect(repo.list({ conversationId: "c-full" }).length).toBe(
      OUTBOX_MAX_PENDING_PER_CONVERSATION,
    );
  }, 30_000);

  it("rejects edits and removals of submitting/accepted rows", () => {
    repo.enqueue({
      id: "e1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "edit me",
      attachments: [],
    });
    const claimed = repo.claimNext("c1");
    expect(claimed?.status).toBe("submitting");
    expect(() => repo.updatePending("e1", { text: "nope" })).toThrow(
      /not editable/,
    );
    expect(() => repo.removePending("e1")).toThrow(/not removable/);

    repo.markAccepted("e1", "task-acc");
    expect(() => repo.updatePending("e1", { text: "nope" })).toThrow();
    expect(() => repo.removePending("e1")).toThrow();
  });

  it("claims FIFO, marks failed/blocked, and retries to pending", () => {
    repo.enqueue({
      id: "q1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "one",
      attachments: [],
    });
    repo.enqueue({
      id: "q2",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "two",
      attachments: [],
    });
    const first = repo.claimNext("c1");
    expect(first?.id).toBe("q1");
    expect(first?.attemptCount).toBe(1);
    // Second claim blocked while submitting.
    expect(repo.claimNext("c1")).toBeNull();

    repo.markFailed("q1", "provider_error");
    expect(repo.get("q1")?.status).toBe("failed");
    const retried = repo.retry("q1");
    expect(retried?.status).toBe("pending");

    repo.markBlockedMissingAttachment("q1");
    expect(repo.get("q1")?.status).toBe("blocked_missing_attachment");
    repo.retry("q1");
    const again = repo.claimNext("c1");
    expect(again?.id).toBe("q1");
  });

  it("releases expired submission leases", () => {
    repo.enqueue({
      id: "lease-1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "leased",
      attachments: [],
    });
    repo.claimNext("c1", OUTBOX_CLAIM_LEASE_MS);
    // Force lease into the past.
    db.prepare(
      `UPDATE conversation_outbox
       SET claim_lease_until = ?
       WHERE id = 'lease-1'`,
    ).run(new Date(Date.now() - 1_000).toISOString());
    expect(repo.releaseExpiredClaims()).toBe(1);
    expect(repo.get("lease-1")?.status).toBe("pending");
    expect(repo.claimNext("c1")?.id).toBe("lease-1");
  });

  it("prunes only old terminal receipts", () => {
    repo.enqueue({
      id: "term-1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "done",
      attachments: [],
    });
    repo.enqueue({
      id: "live-1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "keep",
      attachments: [],
    });
    // Accept the terminal row directly (no claim race with FIFO peers).
    expect(repo.markAccepted("term-1", "task-x")?.status).toBe("accepted");
    expect(repo.get("live-1")?.status).toBe("pending");
    // Age the terminal row.
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    db.prepare(
      `UPDATE conversation_outbox SET updated_at = ? WHERE id = 'term-1'`,
    ).run(old);

    expect(repo.pruneTerminalReceipts(7 * 24 * 60 * 60_000, 10)).toBe(1);
    expect(repo.get("term-1")).toBeNull();
    expect(repo.get("live-1")?.status).toBe("pending");
  });

  it("summary never includes message content", () => {
    repo.enqueue({
      id: "s1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "secret user text that must not leak",
      attachments: [],
    });
    const s = repo.summary();
    expect(s.total).toBe(1);
    expect(s.byStatus.pending).toBe(1);
    expect(s.oldestPendingAgeMs).not.toBeNull();
    expect(JSON.stringify(s)).not.toContain("secret user text");
  });

  it("validates attachment schema before write", () => {
    const bad = repo.enqueue({
      id: "bad-att",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "hi",
      // @ts-expect-error intentional invalid attachment
      attachments: [{ id: "", name: "", sourcePath: "", kind: "file" }],
    });
    expect(bad.outcome).toBe("persistence_failed");
    expect(repo.get("bad-att")).toBeNull();
  });

  it("exports capacity constants used by product policy", () => {
    expect(OUTBOX_MAX_PENDING_PER_CONVERSATION).toBe(200);
    expect(OUTBOX_MAX_PENDING_TOTAL).toBe(2_000);
  });

  it("stores revisionOfTaskId for edit-and-resubmit follow-ups", () => {
    const r = repo.enqueue({
      id: "rev-1",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "revised answer",
      attachments: [],
      revisionOfTaskId: "source-task",
    });
    expect(r.outcome).toBe("accepted");
    if (r.outcome !== "accepted") return;
    expect(r.item.revisionOfTaskId).toBe("source-task");
    expect(repo.get("rev-1")?.revisionOfTaskId).toBe("source-task");
  });
});
