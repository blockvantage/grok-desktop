import { describe, it, expect } from "vitest";
import {
  shouldFireFinishNotifications,
  finishNotificationIntents,
} from "./task-finish-notify";

describe("task-finish-notify", () => {
  it("only fires when finished, Notification exists, and window unfocused", () => {
    expect(
      shouldFireFinishNotifications({
        finishedCount: 1,
        notificationAvailable: true,
        documentHasFocus: false,
      }),
    ).toBe(true);
    expect(
      shouldFireFinishNotifications({
        finishedCount: 1,
        notificationAvailable: true,
        documentHasFocus: true,
      }),
    ).toBe(false);
    expect(
      shouldFireFinishNotifications({
        finishedCount: 0,
        notificationAvailable: true,
        documentHasFocus: false,
      }),
    ).toBe(false);
    expect(
      shouldFireFinishNotifications({
        finishedCount: 2,
        notificationAvailable: false,
        documentHasFocus: false,
      }),
    ).toBe(false);
  });

  it("maps done vs failed title keys from real task status", () => {
    expect(
      finishNotificationIntents([
        { status: "done", goal: "ship it" },
        { status: "failed", goal: "oops" },
      ]),
    ).toEqual([
      { titleKey: "toast.taskComplete", body: "ship it" },
      { titleKey: "toast.taskFailed", body: "oops" },
    ]);
  });
});
