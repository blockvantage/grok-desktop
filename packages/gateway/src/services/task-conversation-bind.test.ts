import { describe, it, expect, vi } from "vitest";
import {
  bindTaskConversation,
  tryBindTaskConversation,
} from "./task-conversation-bind.js";

const task = {
  id: "t1",
  parentTaskId: null as string | null,
  model: "m1",
  goal: "hello",
};

describe("bindTaskConversation", () => {
  it("ensures conversation and appends user turn", () => {
    const ensureForTask = vi.fn(() => ({ id: "conv-1" }));
    const appendTurn = vi.fn();
    const r = bindTaskConversation(task, { ensureForTask, appendTurn });
    expect(r.conversationId).toBe("conv-1");
    expect(ensureForTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "t1",
        providerId: "grok",
      }),
    );
    expect(appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        content: "hello",
        role: "user",
        contextStrategy: "transcript_fallback",
      }),
    );
  });

  it("tryBind swallows errors", () => {
    const r = tryBindTaskConversation(task, {
      ensureForTask: () => {
        throw new Error("db down");
      },
      appendTurn: vi.fn(),
    });
    expect(r).toBeNull();
  });
});
