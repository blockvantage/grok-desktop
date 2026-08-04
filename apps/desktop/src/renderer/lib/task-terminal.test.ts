import { describe, it, expect } from "vitest";
import { isBusyTaskStatus, isTerminalTaskStatus } from "./task-terminal";

describe("isTerminalTaskStatus", () => {
  it("recognizes terminal statuses", () => {
    expect(isTerminalTaskStatus("done")).toBe(true);
    expect(isTerminalTaskStatus("failed")).toBe(true);
    expect(isTerminalTaskStatus("cancelled")).toBe(true);
    expect(isTerminalTaskStatus("running")).toBe(false);
    expect(isTerminalTaskStatus("queued")).toBe(false);
  });
});

describe("isBusyTaskStatus", () => {
  it("is true only while the agent is actively producing a turn", () => {
    expect(isBusyTaskStatus("running")).toBe(true);
    expect(isBusyTaskStatus("queued")).toBe(true);
  });

  it("is false for idle-awaiting-user and terminal states", () => {
    // These are non-terminal but idle: a reply must send, not queue-and-strand.
    expect(isBusyTaskStatus("waiting_user")).toBe(false);
    expect(isBusyTaskStatus("waiting_approval")).toBe(false);
    expect(isBusyTaskStatus("blocked")).toBe(false);
    // Terminal states are obviously not busy.
    expect(isBusyTaskStatus("done")).toBe(false);
    expect(isBusyTaskStatus("failed")).toBe(false);
    expect(isBusyTaskStatus("cancelled")).toBe(false);
  });
});
