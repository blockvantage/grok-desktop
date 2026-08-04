import { describe, expect, it } from "vitest";
import type { TaskEvent } from "@grokdesk/shared";
import {
  findPendingApproval,
  newestNonTerminalTaskId,
} from "./pending-approval";

function ev(
  partial: Pick<TaskEvent, "id" | "taskId" | "kind"> &
    Partial<TaskEvent>,
): TaskEvent {
  return {
    seq: partial.seq ?? 1,
    payload: partial.payload ?? {},
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("newestNonTerminalTaskId", () => {
  it("returns the newest non-terminal turn", () => {
    expect(
      newestNonTerminalTaskId([
        { id: "t1", status: "done" },
        { id: "t2", status: "cancelled" },
        { id: "t3", status: "running" },
      ]),
    ).toBe("t3");
  });

  it("returns null when every turn is terminal", () => {
    expect(
      newestNonTerminalTaskId([
        { id: "t1", status: "done" },
        { id: "t2", status: "cancelled" },
      ]),
    ).toBeNull();
  });
});

describe("findPendingApproval", () => {
  it("resolves approvals by id and deterministically selects the latest remaining key", () => {
    const events = [
      ev({
        id: "required-a",
        taskId: "live",
        kind: "approval_required",
        seq: 1,
        createdAt: "2026-01-01T00:00:01.000Z",
        payload: { approvalId: "a" },
      }),
      ev({
        id: "required-b",
        taskId: "live",
        kind: "approval_required",
        seq: 2,
        createdAt: "2026-01-01T00:00:02.000Z",
        payload: { approvalId: "b" },
      }),
      ev({
        id: "resolved-a",
        taskId: "live",
        kind: "approval_resolved",
        seq: 3,
        createdAt: "2026-01-01T00:00:03.000Z",
        payload: { approvalId: "a" },
      }),
    ];

    expect(findPendingApproval(events, "live")?.payload.approvalId).toBe("b");
    expect(
      findPendingApproval([...events].reverse(), "live")?.payload.approvalId,
    ).toBe("b");
  });

  it("ignores approval_required from a previous turn", () => {
    const events = [
      ev({
        id: "a1",
        taskId: "old",
        kind: "approval_required",
        seq: 1,
        payload: { approvalId: "dead" },
      }),
      ev({
        id: "m1",
        taskId: "new",
        kind: "message",
        seq: 2,
        payload: { role: "assistant", text: "hi" },
      }),
    ];
    expect(findPendingApproval(events, "new")).toBeNull();
  });

  it("returns the live turn's open approval", () => {
    const open = ev({
      id: "a2",
      taskId: "live",
      kind: "approval_required",
      seq: 3,
      payload: { approvalId: "alive" },
    });
    const events = [
      ev({
        id: "a1",
        taskId: "old",
        kind: "approval_required",
        seq: 1,
        payload: { approvalId: "dead" },
      }),
      open,
    ];
    expect(findPendingApproval(events, "live")).toBe(open);
  });

  it("returns null after approval_resolved on the live turn", () => {
    const events = [
      ev({
        id: "a1",
        taskId: "live",
        kind: "approval_required",
        seq: 1,
        payload: { approvalId: "x" },
      }),
      ev({
        id: "r1",
        taskId: "live",
        kind: "approval_resolved",
        seq: 2,
        payload: { approvalId: "x", decision: "reject" },
      }),
    ];
    expect(findPendingApproval(events, "live")).toBeNull();
  });

  it("returns null when there is no live turn", () => {
    const events = [
      ev({
        id: "a1",
        taskId: "t1",
        kind: "approval_required",
        seq: 1,
      }),
    ];
    expect(findPendingApproval(events, null)).toBeNull();
  });
});
