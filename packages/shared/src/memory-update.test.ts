import { describe, expect, it } from "vitest";
import {
  foldMemoryUpdate,
  isMemoryUpdateEvent,
  projectRecalledMemory,
  projectUpdatedMemorySuggestions,
} from "./memory-update.js";

describe("memory updates", () => {
  it("detects MemoryRecalled / MemoryUpdated step titles", () => {
    expect(
      isMemoryUpdateEvent({
        kind: "step",
        payload: { title: "memory_update", action: "recalled" },
      }),
    ).toBe(true);
    expect(isMemoryUpdateEvent({ kind: "message", payload: {} })).toBe(false);
  });

  it("folds recalled memory as verify-context, not a write", () => {
    const view = foldMemoryUpdate({
      kind: "step",
      payload: {
        title: "memory_update",
        action: "recalled",
        content: "User prefers short briefs",
      },
    });
    expect(view).toEqual({
      action: "recalled",
      title: "User prefers short briefs",
      content: "User prefers short briefs",
    });
  });

  it("collects updated engine memories as suggestions", () => {
    const events = [
      {
        kind: "step",
        payload: {
          title: "memory_update",
          sessionUpdate: "MemoryUpdated",
          content: "Prefers 4:3 thumbnails",
        },
      },
      {
        kind: "step",
        payload: {
          title: "memory_update",
          sessionUpdate: "MemoryRecalled",
          content: "Historical: be concise",
        },
      },
    ];
    expect(projectUpdatedMemorySuggestions(events).map((v) => v.content)).toEqual(
      ["Prefers 4:3 thumbnails"],
    );
    expect(projectRecalledMemory(events).map((v) => v.content)).toEqual([
      "Historical: be concise",
    ]);
  });
});
