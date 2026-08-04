import type { TaskAttachment } from "@grokdesk/shared";
import { describe, expect, it } from "vitest";
import {
  beginRevisionSession,
  cancelRevisionSession,
  revisionSessionEligibility,
  revisionSubmitIntent,
} from "./revision-edit-session";

const retained: TaskAttachment = {
  id: "image-1",
  name: "reference.png",
  kind: "image",
  sourcePath: "/missing/reference.png",
  stagedPath: "/workspace/attachments/reference.png",
};

function session() {
  return beginRevisionSession({
    conversationId: "conversation-a",
    sourceTaskId: "task-a",
    initialText: "original",
    attachments: [retained],
    previousText: "draft before edit",
    previousAttachments: [],
    createMutationId: () => "stable-mutation-id",
  });
}

describe("revision edit session", () => {
  it("binds conversation, source, and one stable mutation identity", () => {
    const edit = session();
    expect(edit).toMatchObject({
      conversationId: "conversation-a",
      sourceTaskId: "task-a",
      clientMutationId: "stable-mutation-id",
    });
    expect(
      revisionSubmitIntent(edit, {
        conversationId: "conversation-a",
        editableTaskId: "task-a",
      }),
    ).toEqual({
      allowed: true,
      clientMutationId: "stable-mutation-id",
      revisionOfTaskId: "task-a",
    });
    const retryIntent = revisionSubmitIntent(edit, {
      conversationId: "conversation-a",
      editableTaskId: "task-a",
    });
    expect(retryIntent.allowed).toBe(true);
    if (!retryIntent.allowed) throw new Error("expected an eligible retry");
    expect(retryIntent.clientMutationId).toBe("stable-mutation-id");
  });

  it("invalidates on navigation or when a newer/live task changes eligibility", () => {
    const edit = session();
    expect(
      revisionSessionEligibility(edit, {
        conversationId: "conversation-b",
        editableTaskId: "task-a",
      }),
    ).toBe("conversation_changed");
    expect(
      revisionSessionEligibility(edit, {
        conversationId: "conversation-a",
        editableTaskId: null,
      }),
    ).toBe("source_no_longer_editable");
    expect(
      revisionSubmitIntent(edit, {
        conversationId: "conversation-a",
        editableTaskId: "new-live-task",
      }),
    ).toEqual({ allowed: false, reason: "source_no_longer_editable" });
  });

  it("restores the pre-edit draft and attachment metadata on cancel", () => {
    const restored = cancelRevisionSession(session());
    expect(restored).toEqual({
      text: "draft before edit",
      attachments: [],
    });
  });
});
