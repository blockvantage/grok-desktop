import { describe, it, expect } from "vitest";
import {
  userCancelAttemptTerminal,
  shouldMarkCancelled,
} from "./cancel-attempt.js";

describe("userCancelAttemptTerminal", () => {
  it("returns cancelled + user_cancel", () => {
    expect(userCancelAttemptTerminal()).toEqual({
      status: "cancelled",
      reason: "user_cancel",
    });
  });
});

describe("shouldMarkCancelled re-export", () => {
  it("marks live statuses", () => {
    expect(shouldMarkCancelled("running")).toBe(true);
    expect(shouldMarkCancelled("done")).toBe(false);
  });
});
