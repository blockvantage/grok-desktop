import { describe, it, expect } from "vitest";
import {
  isOptimisticTaskId,
  resolveFollowUpSubmit,
  filePathsFromDropFiles,
  isFollowUpSendDisabled,
} from "./follow-up-submit";

describe("isOptimisticTaskId", () => {
  it("detects optimistic- prefix", () => {
    expect(isOptimisticTaskId("optimistic-1")).toBe(true);
    expect(isOptimisticTaskId("real")).toBe(false);
  });
});

describe("resolveFollowUpSubmit", () => {
  it("noops empty/busy/optimistic", () => {
    expect(
      resolveFollowUpSubmit({
        goal: "  ",
        busy: false,
        optimistic: false,
        agentBusy: false,
      }),
    ).toEqual({ action: "noop" });
    expect(
      resolveFollowUpSubmit({
        goal: "hi",
        busy: true,
        optimistic: false,
        agentBusy: false,
      }),
    ).toEqual({ action: "noop" });
    expect(
      resolveFollowUpSubmit({
        goal: "hi",
        busy: false,
        optimistic: true,
        agentBusy: false,
      }),
    ).toEqual({ action: "noop" });
  });

  it("enqueues only while the agent is actively producing a turn", () => {
    expect(
      resolveFollowUpSubmit({
        goal: " more ",
        busy: false,
        optimistic: false,
        agentBusy: true,
      }),
    ).toEqual({ action: "enqueue", goal: "more" });
  });

  it("sends directly when the agent is idle (terminal OR awaiting the user)", () => {
    // Terminal — was already correct.
    expect(
      resolveFollowUpSubmit({
        goal: "next",
        busy: false,
        optimistic: false,
        agentBusy: false,
      }),
    ).toEqual({ action: "send", goal: "next" });
    // Regression: waiting_user is non-terminal but idle → agentBusy false →
    // the reply must SEND, not queue-and-strand.
    expect(
      resolveFollowUpSubmit({
        goal: "the answer",
        busy: false,
        optimistic: false,
        agentBusy: false,
      }),
    ).toEqual({ action: "send", goal: "the answer" });
  });
});

describe("filePathsFromDropFiles", () => {
  it("filters paths", () => {
    expect(
      filePathsFromDropFiles([{ path: "/a" }, {}, { path: "" }]),
    ).toEqual(["/a"]);
  });
});

describe("isFollowUpSendDisabled", () => {
  it("true when empty or busy", () => {
    expect(
      isFollowUpSendDisabled({ goal: "", busy: false, optimistic: false }),
    ).toBe(true);
    expect(
      isFollowUpSendDisabled({ goal: "x", busy: true, optimistic: false }),
    ).toBe(true);
    expect(
      isFollowUpSendDisabled({ goal: "x", busy: false, optimistic: false }),
    ).toBe(false);
  });
});
