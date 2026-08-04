import { describe, expect, it } from "vitest";
import {
  buildOutboxFollowUpParams,
  FOLLOW_UP_OUTBOX_METHOD,
  type FollowUpEntryPoint,
} from "./outbox-follow-up";

const base = {
  conversationId: "conv-1",
  parentTaskId: "task-1",
  text: "follow up",
  clientMutationId: "mut-1",
};

describe("buildOutboxFollowUpParams", () => {
  const points: FollowUpEntryPoint[] = [
    "composer",
    "answer_question",
    "turn_retry",
    "recovery_retry",
    "post_run_chip",
    "revision",
  ];

  it.each(points)(
    "routes %s through outbox.enqueue params (never tasks.create fields alone)",
    (entryPoint) => {
      const params = buildOutboxFollowUpParams({ ...base, entryPoint });
      expect(FOLLOW_UP_OUTBOX_METHOD).toBe("outbox.enqueue");
      expect(params.id).toBe("mut-1");
      expect(params.conversationId).toBe("conv-1");
      expect(params.parentTaskId).toBe("task-1");
      expect(params.text).toBe("follow up");
      expect(params.entryPoint).toBe(entryPoint);
      // No direct create shape — parent is outbox linkage only.
      expect(params).not.toHaveProperty("goal");
      expect(params).not.toHaveProperty("workspaceRoots");
    },
  );

  it("preserves revision lineage for edit-and-resubmit", () => {
    const params = buildOutboxFollowUpParams({
      ...base,
      entryPoint: "revision",
      revisionOfTaskId: "source-turn",
    });
    expect(params.revisionOfTaskId).toBe("source-turn");
  });

  it("rejects empty text so composer is not cleared", () => {
    expect(() =>
      buildOutboxFollowUpParams({
        ...base,
        text: "   ",
        entryPoint: "composer",
      }),
    ).toThrow(/text required/);
  });

  it("keeps clientMutationId stable for retries of the same action", () => {
    const first = buildOutboxFollowUpParams({
      ...base,
      clientMutationId: "stable-retry",
      entryPoint: "turn_retry",
    });
    const second = buildOutboxFollowUpParams({
      ...base,
      clientMutationId: "stable-retry",
      entryPoint: "turn_retry",
    });
    expect(first.id).toBe(second.id);
  });
});
