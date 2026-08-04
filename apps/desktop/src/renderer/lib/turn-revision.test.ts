import type { TaskAttachment } from "@grokdesk/shared";
import { describe, expect, it } from "vitest";
import type { ConversationTurn } from "./conversation-projector";
import {
  exposedRevisionEditTaskId,
  revisionDraft,
  revisionIntent,
} from "./turn-revision";

const attachment: TaskAttachment = {
  id: "attachment-1",
  name: "brief.pdf",
  sourcePath: "/tmp/brief.pdf",
  kind: "file",
  mime: "application/pdf",
  sizeBytes: 42,
};

function turn(
  id: string,
  state: ConversationTurn["state"],
): ConversationTurn {
  return {
    id,
    taskId: id,
    userMessage: `Message ${id}`,
    attachments: [attachment],
    attachmentsKnown: true,
    revisionOfTurnId: null,
    superseded: false,
    state,
    primaryRun: {
      id,
      state,
      startedAt: "2026-07-15T12:00:00.000Z",
      completedAt: state === "done" ? "2026-07-15T12:01:00.000Z" : null,
    },
    workers: {},
    answer: null,
    work: [],
    artifacts: [],
    approval: null,
    error: null,
    plan: null,
    citations: [],
  };
}

describe("turn revision", () => {
  it("allows only the latest accepted terminal turn", () => {
    const previous = turn("task-1", "done");
    const latest = turn("task-2", "done");

    expect(revisionIntent(latest, latest.taskId)).toEqual({
      sourceTaskId: latest.taskId,
      initialText: latest.userMessage,
      allowed: true,
    });
    expect(revisionIntent(previous, latest.taskId).allowed).toBe(false);
    expect(revisionIntent(turn("task-3", "running"), "task-3").allowed).toBe(
      false,
    );
    expect(revisionIntent(turn("task-4", "queued"), "task-4").allowed).toBe(
      false,
    );
  });

  it("copies attachment metadata into the revision draft", () => {
    const latest = turn("task-2", "failed");

    const draft = revisionDraft(latest, latest.taskId);

    expect(draft).toMatchObject({
      sourceTaskId: "task-2",
      initialText: "Message task-2",
      attachments: [attachment],
      allowed: true,
    });
    expect(draft.attachments).not.toBe(latest.attachments);
    expect(draft.attachments[0]).not.toBe(latest.attachments[0]);
  });

  it("rejects legacy unknown attachment metadata but accepts exact empty inputs", () => {
    const legacy = { ...turn("legacy", "done"), attachments: [], attachmentsKnown: false };
    const exactEmpty = { ...turn("exact", "done"), attachments: [], attachmentsKnown: true };

    expect(revisionIntent(legacy, legacy.taskId).allowed).toBe(false);
    expect(revisionIntent(exactEmpty, exactEmpty.taskId).allowed).toBe(true);
  });

  it("hides Edit while a session is open without changing eligibility", () => {
    expect(exposedRevisionEditTaskId("task-1", false)).toBe("task-1");
    expect(exposedRevisionEditTaskId("task-1", true)).toBeNull();
    expect(exposedRevisionEditTaskId(null, false)).toBeNull();
  });
});
