import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { ConversationOutboxRepository } from "./conversation-outbox.js";
import {
  dispatchOutboxMethod,
  isOutboxMethod,
  OUTBOX_METHODS,
} from "./outbox-dispatch.js";

describe("outbox-dispatch", () => {
  let dir: string;
  let db: Db;
  let outbox: ConversationOutboxRepository;
  let notify: ReturnType<typeof vi.fn>;
  let scheduleDrain: ReturnType<typeof vi.fn>;
  let interject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-outbox-d-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
    outbox = new ConversationOutboxRepository(db);
    notify = vi.fn();
    scheduleDrain = vi.fn();
    interject = vi.fn(async () => false);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function deps(overrides: Partial<Parameters<typeof dispatchOutboxMethod>[2]> = {}) {
    return {
      outbox,
      notifyOutboxChanged: notify,
      scheduleDrain,
      interject,
      ...overrides,
    };
  }

  it("registers all seven outbox methods", () => {
    expect(OUTBOX_METHODS.size).toBe(7);
    for (const m of OUTBOX_METHODS) {
      expect(isOutboxMethod(m)).toBe(true);
    }
    expect(isOutboxMethod("tasks.create")).toBe(false);
  });

  it("enqueues with zod validation and notifies without content", async () => {
    const result = await dispatchOutboxMethod(
      "outbox.enqueue",
      {
        id: "m1",
        conversationId: "c1",
        parentTaskId: "t1",
        text: "hello secret",
        attachments: [],
      },
      deps(),
    );
    expect(result).toMatchObject({
      outcome: "accepted",
      item: { id: "m1", status: "pending" },
    });
    expect(scheduleDrain).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "c1",
        itemIds: ["m1"],
        reason: "enqueue",
      }),
    );
    const payload = JSON.stringify(notify.mock.calls[0]![0]);
    expect(payload).not.toContain("hello secret");

    await expect(
      dispatchOutboxMethod(
        "outbox.enqueue",
        { id: "", conversationId: "c1", parentTaskId: "t1", text: "x" },
        deps(),
      ),
    ).rejects.toThrow();
  });

  it("lists, updates, retries, removes, and summarizes", async () => {
    await dispatchOutboxMethod(
      "outbox.enqueue",
      {
        id: "m1",
        conversationId: "c1",
        parentTaskId: "t1",
        text: "one",
        attachments: [],
      },
      deps(),
    );
    const list = (await dispatchOutboxMethod(
      "outbox.list",
      { conversationId: "c1" },
      deps(),
    )) as Array<{ id: string }>;
    expect(list.map((i) => i.id)).toEqual(["m1"]);

    const updated = await dispatchOutboxMethod(
      "outbox.update",
      { id: "m1", text: "two" },
      deps(),
    );
    expect(updated).toMatchObject({ text: "two", status: "pending" });

    outbox.markFailed("m1", "transient");
    const retried = await dispatchOutboxMethod(
      "outbox.retry",
      { id: "m1" },
      deps(),
    );
    expect(retried).toMatchObject({ status: "pending" });
    expect(scheduleDrain).toHaveBeenCalled();

    await dispatchOutboxMethod("outbox.remove", { id: "m1" }, deps());
    expect(
      await dispatchOutboxMethod("outbox.list", { conversationId: "c1" }, deps()),
    ).toEqual([]);

    const summary = await dispatchOutboxMethod("outbox.summary", {}, deps());
    expect(summary).toMatchObject({
      total: expect.any(Number),
      byStatus: expect.any(Object),
    });
    expect(JSON.stringify(summary)).not.toContain("two");
  });

  it("sendNow delivers via interject and never creates tasks on unsupported", async () => {
    await dispatchOutboxMethod(
      "outbox.enqueue",
      {
        id: "m-send",
        conversationId: "c1",
        parentTaskId: "live-task",
        text: "nudge",
        attachments: [],
      },
      deps(),
    );

    interject.mockResolvedValueOnce(false);
    const unsupported = await dispatchOutboxMethod(
      "outbox.sendNow",
      { id: "m-send" },
      deps(),
    );
    expect(unsupported).toMatchObject({
      delivered: false,
      reason: "unsupported",
    });
    expect(outbox.get("m-send")?.status).toBe("pending");

    interject.mockResolvedValueOnce(true);
    const ok = await dispatchOutboxMethod(
      "outbox.sendNow",
      { id: "m-send" },
      deps(),
    );
    expect(ok).toMatchObject({ delivered: true });
    expect(interject).toHaveBeenCalledWith("live-task", "nudge", "m-send");
    expect(outbox.get("m-send")?.status).toBe("delivered");
  });

  it("sendNow without interject handler keeps item queued", async () => {
    await dispatchOutboxMethod(
      "outbox.enqueue",
      {
        id: "m2",
        conversationId: "c1",
        parentTaskId: "t1",
        text: "x",
        attachments: [],
      },
      deps(),
    );
    const r = await dispatchOutboxMethod(
      "outbox.sendNow",
      { id: "m2" },
      deps({ interject: undefined }),
    );
    expect(r).toMatchObject({ delivered: false, reason: "unsupported" });
    expect(outbox.get("m2")?.status).toBe("pending");
  });

  it("enqueue is idempotent for same id/payload", async () => {
    const payload = {
      id: "dup",
      conversationId: "c1",
      parentTaskId: "t1",
      text: "same",
      attachments: [],
    };
    const a = await dispatchOutboxMethod("outbox.enqueue", payload, deps());
    const b = await dispatchOutboxMethod("outbox.enqueue", payload, deps());
    expect(a).toMatchObject({ outcome: "accepted" });
    expect(b).toMatchObject({ outcome: "accepted" });
    expect(
      (await dispatchOutboxMethod("outbox.list", {}, deps())) as unknown[],
    ).toHaveLength(1);
  });
});
