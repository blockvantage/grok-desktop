import { describe, it, expect } from "vitest";
import { approvalIdFromPendingEvent } from "./pending-approval-id";

describe("approvalIdFromPendingEvent", () => {
  it("reads string approvalId", () => {
    expect(
      approvalIdFromPendingEvent({ payload: { approvalId: "ap-1" } }),
    ).toBe("ap-1");
  });

  it("null when missing", () => {
    expect(approvalIdFromPendingEvent(null)).toBeNull();
    expect(approvalIdFromPendingEvent({ payload: {} })).toBeNull();
    expect(
      approvalIdFromPendingEvent({ payload: { approvalId: 1 } }),
    ).toBeNull();
  });
});
