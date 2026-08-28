/**
 * jsdom + Testing Library: approve and edit-turn clicks (Phase 2.7).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConversationTurn as ConversationTurnView } from "@/lib/conversation-projector";
import { ConversationTurn } from "./conversation-turn";

function turn(
  state: ConversationTurnView["state"] = "waiting_approval",
): ConversationTurnView {
  return {
    id: "turn-1",
    taskId: "task-1",
    userMessage: "Build the release notes",
    attachments: [],
    attachmentsKnown: true,
    revisionOfTurnId: null,
    superseded: false,
    state,
    primaryRun: {
      id: "task-1",
      state,
      startedAt: "2026-07-15T12:00:00.000Z",
      completedAt: null,
    },
    workers: {},
    liveSummary: null,
    answer: null,
    work: [],
    artifacts: [],
    approval:
      state === "waiting_approval"
        ? {
            approvalId: "approval-1",
            eventId: "approval-event",
            summary: "Publish the report?",
            createdAt: "2026-07-15T12:00:05.000Z",
            payload: {},
          }
        : null,
    error: null,
    plan: null,
    citations: [],
  };
}

describe("ConversationTurn interactions", () => {
  it("approves from the parked card", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn(async () => {});
    const onReject = vi.fn(async () => {});
    render(
      <ConversationTurn
        turn={turn("waiting_approval")}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    await user.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();
  });

  it("remembers the answer in one tap", async () => {
    const user = userEvent.setup();
    const onRememberAnswer = vi.fn(async () => {});
    const done = turn("done");
    done.answer = {
      eventId: "a1",
      text: "Here is a full marketing brief with three channels.",
      createdAt: "2026-07-15T12:00:10.000Z",
    };
    render(
      <ConversationTurn turn={done} onRememberAnswer={onRememberAnswer} />,
    );
    await user.click(screen.getByTestId("remember-answer"));
    expect(onRememberAnswer).toHaveBeenCalled();
  });

  it("opens the edit field from Edit", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<ConversationTurn turn={turn("done")} onEdit={onEdit} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(onEdit).toHaveBeenCalled();
  });
});
