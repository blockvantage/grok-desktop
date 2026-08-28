/**
 * jsdom + Testing Library: Send now click (Phase 2.7).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueuedMessageRow } from "./queued-message-row";
import type { DurableQueuedMessage } from "@/lib/message-queue-store";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      "workspace.queueSendNow": "Send now",
      "workspace.queueSendNowUnavailable": "Send now is unavailable",
      "workspace.queueRetry": "Retry",
      "workspace.queueRemove": "Remove from queue",
      "workspace.queueEdit": "Edit message",
    };
    return map[key] ?? key;
  },
}));

function pending(): DurableQueuedMessage {
  return {
    id: "queue-1",
    text: "Please check the release",
    createdAt: "2026-07-16T12:00:00.000Z",
    conversationId: "conversation-1",
    status: "pending",
    clientMutationId: "mutation-1",
    claimedAt: null,
  };
}

describe("QueuedMessageRow interactions", () => {
  it("fires Send now on click when interject is supported", async () => {
    const user = userEvent.setup();
    const onSendNow = vi.fn();
    render(
      <QueuedMessageRow
        item={pending()}
        index={0}
        busy={false}
        sendNowSupported
        onEdit={vi.fn()}
        onEditAndSendNow={vi.fn()}
        onRetry={vi.fn()}
        onSendNow={onSendNow}
        onRemove={vi.fn()}
        onPickFiles={vi.fn().mockResolvedValue([])}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Send now" }));
    expect(onSendNow).toHaveBeenCalledTimes(1);
    expect(onSendNow.mock.calls[0]?.[0]?.id).toBe("queue-1");
  });

  it("does not fire Send now when the engine cannot interject", async () => {
    const user = userEvent.setup();
    const onSendNow = vi.fn();
    render(
      <QueuedMessageRow
        item={pending()}
        index={0}
        busy={false}
        sendNowSupported={false}
        onEdit={vi.fn()}
        onEditAndSendNow={vi.fn()}
        onRetry={vi.fn()}
        onSendNow={onSendNow}
        onRemove={vi.fn()}
        onPickFiles={vi.fn().mockResolvedValue([])}
      />,
    );
    const send = screen.getByRole("button", { name: "Send now" });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(onSendNow).not.toHaveBeenCalled();
  });
});
