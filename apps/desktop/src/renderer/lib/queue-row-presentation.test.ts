import { describe, expect, it } from "vitest";
import {
  planComposerOfflineAction,
  planEnqueueRejectionFeedback,
  planQueueLifecycleStatus,
  type QueueLifecycleInput,
} from "./queue-row-presentation";

function base(partial: Partial<QueueLifecycleInput> = {}): QueueLifecycleInput {
  return {
    status: "pending",
    index: 0,
    interjecting: false,
    failReason: null,
    ...partial,
  };
}

describe("planQueueLifecycleStatus", () => {
  it("labels position as Queued · N ahead when later in the FIFO", () => {
    const s = planQueueLifecycleStatus(base({ index: 2 }));
    expect(s.key).toBe("workspace.queueAhead");
    expect(s.params).toEqual({ count: 2 });
    expect(s.plain).toBe("Queued · 2 ahead");
  });

  it("labels front pending as Saved locally (SQLite durable, not yet sending)", () => {
    expect(planQueueLifecycleStatus(base({ index: 0 })).key).toBe(
      "workspace.queueSavedLocally",
    );
    expect(planQueueLifecycleStatus(base({ index: 0 })).plain).toBe(
      "Saved locally",
    );
  });

  it("labels interject / submit as Sending", () => {
    expect(
      planQueueLifecycleStatus(base({ interjecting: true })).key,
    ).toBe("workspace.queueSending");
    expect(
      planQueueLifecycleStatus(base({ status: "submitting" })).key,
    ).toBe("workspace.queueSubmitting");
  });

  it("labels missing attachment and needs retry distinctly", () => {
    expect(
      planQueueLifecycleStatus(
        base({ status: "failed", failReason: "missing_attachment" }),
      ).key,
    ).toBe("workspace.queueMissingAttachment");
    expect(planQueueLifecycleStatus(base({ status: "failed" })).key).toBe(
      "workspace.queueNeedsRetry",
    );
    expect(planQueueLifecycleStatus(base({ status: "failed" })).plain).toBe(
      "Needs retry",
    );
  });
});

describe("planComposerOfflineAction", () => {
  it("uses Save when engine is ready while reconnecting with a draft", () => {
    const a = planComposerOfflineAction({
      engineReady: false,
      hasDraft: true,
      hasSavedLocalQueue: false,
    });
    expect(a).not.toBeNull();
    expect(a!.key).toBe("workspace.composerSaveWhenReady");
    expect(a!.plain).toMatch(/engine is ready/i);
  });

  it("uses Saved locally when queue already has durable rows offline", () => {
    const a = planComposerOfflineAction({
      engineReady: false,
      hasDraft: false,
      hasSavedLocalQueue: true,
    });
    expect(a).not.toBeNull();
    expect(a!.key).toBe("workspace.queueSavedLocally");
  });

  it("uses Try again when ready path failed transiently", () => {
    const a = planComposerOfflineAction({
      engineReady: true,
      hasDraft: true,
      lastError: "transient",
    });
    expect(a).not.toBeNull();
    expect(a!.key).toBe("workspace.composerTryAgain");
    expect(a!.plain).toBe("Try again");
  });

  it("returns null when engine is ready and no error", () => {
    expect(
      planComposerOfflineAction({
        engineReady: true,
        hasDraft: true,
        hasSavedLocalQueue: false,
      }),
    ).toBeNull();
  });
});

describe("planEnqueueRejectionFeedback", () => {
  it("keeps draft, refocuses composer, and announces once adjacent", () => {
    const f = planEnqueueRejectionFeedback({
      outcome: "full",
      previousText: "keep me",
    });
    expect(f.clearDraft).toBe(false);
    expect(f.refocusComposer).toBe(true);
    expect(f.announceOnce).toBe(true);
    expect(f.messageKey).toBe("workspace.queueFull");
    expect(f.retainedText).toBe("keep me");
  });

  it("maps engine-not-ready to save-when-ready copy", () => {
    const f = planEnqueueRejectionFeedback({
      outcome: "unavailable",
      reason: "engine not ready",
      previousText: "still here",
    });
    expect(f.clearDraft).toBe(false);
    expect(f.messageKey).toBe("workspace.composerSaveWhenReady");
  });

  it("maps persistence failure to send-failed with draft retained", () => {
    const f = planEnqueueRejectionFeedback({
      outcome: "persistence_failed",
      previousText: "x",
    });
    expect(f.clearDraft).toBe(false);
    expect(f.messageKey).toBe("workspace.queueSendFailed");
  });
});
