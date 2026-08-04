import { describe, expect, it } from "vitest";
import {
  buildWorkBoard,
  classifyWorkStatus,
  shouldShowWorkBoard,
  urgencyForStatus,
  workBoardHeadline,
} from "./concurrent-work-board";

describe("concurrent-work-board", () => {
  it("classifies statuses and ranks needs-you first", () => {
    expect(classifyWorkStatus("waiting_approval")).toBe("needs_you");
    expect(urgencyForStatus("needs_you")).toBeGreaterThan(
      urgencyForStatus("working"),
    );

    const board = buildWorkBoard([
      {
        id: "a",
        goal: "background research",
        status: "running",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
      {
        id: "b",
        title: "Approve deploy",
        goal: "deploy",
        status: "waiting_user",
        updatedAt: "2026-07-15T09:00:00.000Z",
      },
      {
        id: "c",
        goal: "broken scrape",
        status: "failed",
        updatedAt: "2026-07-15T11:00:00.000Z",
      },
    ]);

    expect(board.items[0]!.taskId).toBe("b");
    expect(board.needsYouCount).toBe(1);
    expect(board.workingCount).toBe(1);
    expect(board.failedCount).toBe(1);
    expect(shouldShowWorkBoard(board)).toBe(true);
    expect(board.headline).toMatch(/need/i);
  });

  it("does not surface failed-only desks as a work board", () => {
    const board = buildWorkBoard([
      {
        id: "f",
        goal: "broken",
        status: "failed",
        updatedAt: "2026-07-15T11:00:00.000Z",
      },
    ]);
    expect(board.failedCount).toBe(1);
    expect(shouldShowWorkBoard(board)).toBe(false);
  });

  it("shows clear desk when idle", () => {
    const board = buildWorkBoard([
      {
        id: "d",
        goal: "done",
        status: "done",
        updatedAt: "2026-07-15T08:00:00.000Z",
      },
    ]);
    expect(shouldShowWorkBoard(board)).toBe(false);
    expect(workBoardHeadline({ needsYouCount: 0, workingCount: 0, failedCount: 0, total: 0 })).toMatch(
      /start a goal/i,
    );
  });
});
