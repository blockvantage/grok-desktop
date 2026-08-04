import { describe, expect, it, vi } from "vitest";
import {
  attachmentsFromQueuedPaths,
  claimQueuedMessage,
  createQueuedMessage,
  dequeueMessage,
  editQueuedMessage,
  enqueueMessage,
  forceDequeueMessage,
  markQueuedFailed,
  markQueuedPending,
  nextDrainableMessage,
  removeQueuedMessage,
  sendQueuedMessage,
} from "./message-queue";

describe("message queue", () => {
  it("enqueues and dequeues FIFO", () => {
    let q = enqueueMessage([], createQueuedMessage("first"));
    q = enqueueMessage(q, createQueuedMessage("second"));
    expect(q).toHaveLength(2);
    const a = dequeueMessage(q);
    expect(a.item?.text).toBe("first");
    expect(a.next).toHaveLength(1);
    const b = dequeueMessage(a.next);
    expect(b.item?.text).toBe("second");
    expect(b.next).toHaveLength(0);
  });

  it("removes by id", () => {
    const a = createQueuedMessage("a");
    const b = createQueuedMessage("b");
    const q = enqueueMessage(enqueueMessage([], a), b);
    expect(removeQueuedMessage(q, a.id).map((m) => m.text)).toEqual(["b"]);
  });

  it("forceDequeue pulls a middle item", () => {
    const a = createQueuedMessage("a");
    const b = createQueuedMessage("b");
    const c = createQueuedMessage("c");
    let q = [a, b, c];
    const r = forceDequeueMessage(q, b.id);
    expect(r.item?.text).toBe("b");
    expect(r.next.map((m) => m.text)).toEqual(["a", "c"]);
  });

  it("ignores empty text", () => {
    expect(enqueueMessage([], createQueuedMessage("   "))).toHaveLength(0);
  });

  it("stores attachment paths on create", () => {
    const m = createQueuedMessage("with image", ["/tmp/shot.png"]);
    expect(m.attachmentPaths).toEqual(["/tmp/shot.png"]);
    expect(m.status).toBe("pending");
  });

  it("attachmentsFromQueuedPaths rebuilds TaskAttachment[] for onFollowUp", () => {
    const atts = attachmentsFromQueuedPaths([
      "/Users/me/Desktop/shot.png",
      "C:\\docs\\notes.md",
    ]);
    expect(atts).toHaveLength(2);
    expect(atts![0]).toMatchObject({
      sourcePath: "/Users/me/Desktop/shot.png",
      name: "shot.png",
      kind: "image",
    });
    expect(atts![1]).toMatchObject({
      sourcePath: "C:\\docs\\notes.md",
      name: "notes.md",
      kind: "file",
    });
  });

  it("sendQueuedMessage forwards attachments to onFollowUp", async () => {
    const onFollowUp = vi.fn().mockResolvedValue(true);
    const item = createQueuedMessage("caption", ["/tmp/a.png"]);
    const result = await sendQueuedMessage(item, onFollowUp);
    expect(result).toBe("sent");
    expect(onFollowUp).toHaveBeenCalledWith(
      "caption",
      expect.arrayContaining([
        expect.objectContaining({ sourcePath: "/tmp/a.png" }),
      ]),
    );
  });

  it("sendQueuedMessage returns failed when onFollowUp rejects", async () => {
    const onFollowUp = vi.fn().mockRejectedValue(new Error("gateway down"));
    const item = createQueuedMessage("keep me");
    expect(await sendQueuedMessage(item, onFollowUp)).toBe("failed");
  });

  it("sendQueuedMessage returns failed when onFollowUp returns false", async () => {
    const onFollowUp = vi.fn().mockResolvedValue(false);
    const item = createQueuedMessage("keep me");
    expect(await sendQueuedMessage(item, onFollowUp)).toBe("failed");
  });

  it("success-only drain: keep item and mark failed on reject", async () => {
    let q = [createQueuedMessage("important", ["/tmp/x.png"])];
    const item = nextDrainableMessage(q)!;
    const result = await sendQueuedMessage(item, async () => false);
    expect(result).toBe("failed");
    // Caller must not remove on failure
    q = markQueuedFailed(q, item.id);
    expect(q).toHaveLength(1);
    expect(q[0]!.status).toBe("failed");
    // Failed items are skipped by auto-drain
    expect(nextDrainableMessage(q)).toBeNull();
    // User retry re-enables drain
    q = markQueuedPending(q, item.id);
    expect(nextDrainableMessage(q)?.id).toBe(item.id);
  });

  it("success-only drain: remove item only after send succeeds", async () => {
    let q = [createQueuedMessage("go")];
    const item = nextDrainableMessage(q)!;
    const result = await sendQueuedMessage(item, async () => true);
    expect(result).toBe("sent");
    q = removeQueuedMessage(q, item.id);
    expect(q).toHaveLength(0);
  });

  it("claim prevents dual send paths", () => {
    let q = [createQueuedMessage("once")];
    const id = q[0]!.id;
    const a = claimQueuedMessage(q, id);
    expect(a.item?.status).toBe("sending");
    q = a.next;
    const b = claimQueuedMessage(q, id);
    expect(b.item).toBeNull();
    expect(nextDrainableMessage(q)).toBeNull();
  });

  it("edit updates text and attachments while pending", () => {
    let q = [createQueuedMessage("old")];
    const id = q[0]!.id;
    q = editQueuedMessage(q, id, {
      text: "new",
      attachmentPaths: ["/a.png"],
    });
    expect(q[0]?.text).toBe("new");
    expect(q[0]?.attachmentPaths).toEqual(["/a.png"]);
  });

  it("edit can remove and replace attachment paths", () => {
    let q = [createQueuedMessage("cap", ["/a.png", "/b.pdf"])];
    const id = q[0]!.id;
    q = editQueuedMessage(q, id, { attachmentPaths: ["/b.pdf"] });
    expect(q[0]?.attachmentPaths).toEqual(["/b.pdf"]);
    q = editQueuedMessage(q, id, { attachmentPaths: [] });
    expect(q[0]?.attachmentPaths).toBeUndefined();
  });
});
