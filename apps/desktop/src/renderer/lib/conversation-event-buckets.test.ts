import type { TaskEvent } from "@grokdesk/shared";
import { describe, expect, it } from "vitest";
import {
  eventsByTaskForOwners,
  requestedChatLoading,
} from "./conversation-event-buckets";

function event(taskId: string): TaskEvent {
  return {
    id: "event-1",
    taskId,
    seq: 1,
    kind: "message",
    payload: { role: "assistant", text: "Owned event" },
    createdAt: "2026-07-15T12:00:00.000Z",
  };
}

describe("authoritative conversation event buckets", () => {
  it("reports a requested cold chat as loading before its effect owns it", () => {
    expect(
      requestedChatLoading({
        taskSurface: "workspace",
        requestedChatId: "cold-chat",
        turnCount: 1,
        ownedChatId: "",
        stateLoading: false,
      }),
    ).toBe(true);
  });

  it("reports a cold chat switch as loading before ownership changes", () => {
    expect(
      requestedChatLoading({
        taskSurface: "workspace",
        requestedChatId: "next-chat",
        turnCount: 1,
        ownedChatId: "previous-chat",
        stateLoading: false,
      }),
    ).toBe(true);
  });

  it("never moves a cached event into its embedded task-id bucket", () => {
    const mismatched = event("intruder");
    const byTask = eventsByTaskForOwners(
      [{ id: "owner" }],
      new Map([["owner", [mismatched]]]),
    );

    expect(byTask.owner).toEqual([mismatched]);
    expect(byTask.intruder).toBeUndefined();
  });
});
