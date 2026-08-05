import { describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@grokdesk/shared";
import {
  reconcileAssistantTurn,
  selectSafeAssistantFinal,
} from "./assistant-turn-reconciliation.js";

function event(
  seq: number,
  kind: TaskEvent["kind"],
  payload: Record<string, unknown>,
): TaskEvent {
  return {
    id: `event-${seq}`,
    taskId: "task-1",
    seq,
    kind,
    payload,
    createdAt: `2026-08-05T00:00:0${seq}.000Z`,
  };
}

describe("assistant turn reconciliation", () => {
  it("selects the latest safe assistant response and skips protocol JSON", () => {
    const events = [
      event(1, "message", {
        role: "assistant",
        channel: "text",
        text: "I’ll inspect that.",
      }),
      event(2, "tool_request", { id: "tool-1", tool: "read_file" }),
      event(3, "message", {
        role: "assistant",
        channel: "text",
        text: JSON.stringify({
          type: "tool_call_update",
          content: [{ type: "image", data: "A".repeat(4_096) }],
        }),
      }),
      event(4, "message", {
        role: "assistant",
        channel: "text",
        text: "The page is ready.",
      }),
    ];

    expect(selectSafeAssistantFinal(events)).toBe("The page is ready.");
  });

  it("reassembles adjacent streamed text chunks", () => {
    expect(
      selectSafeAssistantFinal([
        event(1, "message", {
          role: "assistant",
          channel: "text",
          text: "The page",
        }),
        event(2, "message", {
          role: "assistant",
          channel: "text",
          text: " is ready.",
        }),
      ]),
    ).toBe("The page is ready.");
  });

  it("keeps the real ACP answer instead of its terminal lifecycle marker", () => {
    expect(
      selectSafeAssistantFinal([
        event(1, "message", {
          role: "assistant",
          channel: "text",
          text: "The detailed review found two issues and both are fixed.",
        }),
        event(2, "message", {
          role: "assistant",
          channel: "text",
          terminal: true,
          text: "ACP turn complete",
        }),
      ]),
    ).toBe("The detailed review found two issues and both are fixed.");
  });

  it("prefers a substantive streamed answer over a shorter terminal summary", () => {
    const linkedAnswer =
      "Your launch brief is ready. Review the [Electron security guide](https://www.electronjs.org/docs/latest/tutorial/security) for the linked source.";

    expect(
      selectSafeAssistantFinal([
        event(1, "message", {
          role: "assistant",
          channel: "text",
          text: "I’m drafting a focused brief now.",
        }),
        event(2, "tool_request", { id: "tool-1", tool: "write_file" }),
        event(3, "message", {
          role: "assistant",
          channel: "text",
          text: linkedAnswer,
        }),
        event(4, "message", {
          role: "assistant",
          channel: "text",
          terminal: true,
          text: "Launch brief ready — saved to your workspace.",
        }),
      ]),
    ).toBe(linkedAnswer);
  });

  it("preserves a multi-part final across citation metadata", () => {
    expect(
      selectSafeAssistantFinal([
        event(1, "message", {
          role: "assistant",
          channel: "text",
          text: "The first finding is confirmed.",
        }),
        event(2, "citations", {
          items: [{ url: "https://example.com/source" }],
        }),
        event(3, "message", {
          role: "assistant",
          channel: "text",
          text: "The second finding needs follow-up.",
        }),
      ]),
    ).toBe(
      "The first finding is confirmed.\n\nThe second finding needs follow-up.",
    );
  });

  it("appends a complete assistant turn with task metadata", () => {
    const appendTurn = vi.fn((input) => input);
    const result = reconcileAssistantTurn({
      task: {
        id: "task-1",
        conversationId: "conversation-1",
        model: "grok-4.5",
      },
      events: [
        event(1, "message", {
          role: "assistant",
          channel: "text",
          text: "Ready.",
        }),
      ],
      appendTurn,
    });

    expect(result).toEqual(expect.objectContaining({ content: "Ready." }));
    expect(appendTurn).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      taskId: "task-1",
      role: "assistant",
      content: "Ready.",
      contextStrategy: "transcript_fallback",
      modelId: "grok-4.5",
      providerId: "grok",
      createdAt: "2026-08-05T00:00:01.000Z",
      replaceExisting: true,
    });
  });
});
