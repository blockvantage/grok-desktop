import { describe, it, expect } from "vitest";
import {
  shouldAbortHandleEvent,
  shouldAbortAfterApprovalWait,
} from "./should-abort-handle-event.js";

describe("shouldAbortHandleEvent", () => {
  it("aborts when paused", () => {
    expect(
      shouldAbortHandleEvent({ paused: true, task: { status: "running" } }),
    ).toBe(true);
  });

  it("aborts when task missing", () => {
    expect(shouldAbortHandleEvent({ paused: false, task: null })).toBe(true);
    expect(shouldAbortHandleEvent({ paused: false, task: undefined })).toBe(
      true,
    );
  });

  it("aborts when cancelled", () => {
    expect(
      shouldAbortHandleEvent({
        paused: false,
        task: { status: "cancelled" },
      }),
    ).toBe(true);
  });

  it("continues for running/waiting tasks", () => {
    expect(
      shouldAbortHandleEvent({ paused: false, task: { status: "running" } }),
    ).toBe(false);
    expect(
      shouldAbortHandleEvent({
        paused: false,
        task: { status: "waiting_approval" },
      }),
    ).toBe(false);
  });
});

describe("shouldAbortAfterApprovalWait", () => {
  it("aborts when missing or cancelled", () => {
    expect(shouldAbortAfterApprovalWait(null)).toBe(true);
    expect(shouldAbortAfterApprovalWait({ status: "cancelled" })).toBe(true);
  });

  it("continues when still live", () => {
    expect(shouldAbortAfterApprovalWait({ status: "waiting_approval" })).toBe(
      false,
    );
  });
});
