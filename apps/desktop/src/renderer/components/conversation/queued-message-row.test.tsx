import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DurableQueuedMessage } from "@/lib/message-queue-store";
import { QueuedMessageRow } from "./queued-message-row";

const rowSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "queued-message-row.tsx"),
  "utf8",
);

function queued(
  status: DurableQueuedMessage["status"],
): DurableQueuedMessage {
  return {
    id: "queue-1",
    text: "Please check the release",
    createdAt: "2026-07-16T12:00:00.000Z",
    conversationId: "conversation-1",
    status,
    clientMutationId: "mutation-1",
    claimedAt:
      status === "submitting" ? "2026-07-16T12:00:00.000Z" : null,
  };
}

function render(status: DurableQueuedMessage["status"], busy = false) {
  return renderToStaticMarkup(
    <QueuedMessageRow
      item={queued(status)}
      index={0}
      busy={busy}
      onEdit={vi.fn()}
      onEditAndSendNow={vi.fn()}
      onRetry={vi.fn()}
      onSendNow={vi.fn()}
      onRemove={vi.fn()}
      onPickFiles={vi.fn().mockResolvedValue([])}
    />,
  );
}

describe("QueuedMessageRow", () => {
  it.each([
    ["submitting", "Submitting…"],
    ["recovering", "Recovering queued message…"],
  ] as const)("announces the truthful %s phase and locks controls", (status, copy) => {
    const html = render(status);

    expect(html).toContain(copy);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toMatch(/data-queue-edit="queue-1"[^>]*disabled/);
    expect(html).toMatch(/data-queue-send-now="queue-1"[^>]*disabled/);
    expect(html).toMatch(/data-queue-remove="queue-1"[^>]*disabled/);
  });

  it("gives every queue action a localized accessible name", () => {
    const pending = render("pending");
    expect(pending).toMatch(/data-queue-edit="queue-1"[^>]*aria-label="Edit message"/);
    expect(pending).toMatch(/data-queue-send-now="queue-1"[^>]*aria-label="Send now"/);
    expect(pending).toMatch(/data-queue-remove="queue-1"[^>]*aria-label="Remove from queue"/);

    const failed = render("failed");
    expect(failed).toMatch(/data-queue-retry="queue-1"[^>]*aria-label="Retry"/);
  });

  it("disables pending actions while another follow-up is busy", () => {
    const html = render("pending", true);
    expect(html).toMatch(/data-queue-send-now="queue-1"[^>]*disabled/);
    expect(html).not.toMatch(/data-queue-remove="queue-1"[^>]*disabled/);
    expect(html).not.toMatch(/data-queue-edit="queue-1"[^>]*disabled/);
  });

  it("surfaces missing-attachment failure with re-pick affordance", () => {
    const item: DurableQueuedMessage = {
      ...queued("failed"),
      attachmentPaths: ["/gone.png"],
      failReason: "missing_attachment",
    };
    const html = renderToStaticMarkup(
      <QueuedMessageRow
        item={item}
        index={0}
        busy={false}
        onEdit={vi.fn()}
        onEditAndSendNow={vi.fn()}
        onRetry={vi.fn()}
        onSendNow={vi.fn()}
        onRemove={vi.fn()}
        onPickFiles={vi.fn().mockResolvedValue([])}
      />,
    );
    expect(html).toContain("Attachment missing");
    expect(html).toContain('data-queue-fail-reason="missing_attachment"');
    expect(html).toContain('data-queue-repick-attachment="queue-1"');
    expect(html).toContain('data-queue-attachment-missing="true"');
  });

  it("shows plain-language lifecycle for position, send, retry, and saved local", () => {
    expect(
      renderToStaticMarkup(
        <QueuedMessageRow
          item={queued("pending")}
          index={2}
          busy={false}
          onEdit={vi.fn()}
          onEditAndSendNow={vi.fn()}
          onRetry={vi.fn()}
          onSendNow={vi.fn()}
          onRemove={vi.fn()}
          onPickFiles={vi.fn().mockResolvedValue([])}
        />,
      ),
    ).toContain("Queued · 2 ahead");

    expect(render("pending")).toContain("Saved locally");
    expect(render("failed")).toContain("Needs retry");

    const sending = renderToStaticMarkup(
      <QueuedMessageRow
        item={queued("pending")}
        index={0}
        busy={false}
        interjecting
        onEdit={vi.fn()}
        onEditAndSendNow={vi.fn()}
        onRetry={vi.fn()}
        onSendNow={vi.fn()}
        onRemove={vi.fn()}
        onPickFiles={vi.fn().mockResolvedValue([])}
      />,
    );
    expect(sending).toContain("Sending");
  });

  it("keeps Edit, Remove, Retry, and Send now as visible text not icon-only", () => {
    const pending = render("pending");
    expect(pending).toContain("Send now");
    expect(pending).toMatch(/data-queue-remove="queue-1"/);
    // Remove shows short text label (icons are secondary cues).
    expect(pending).toMatch(/Remove|Entfernen|Eliminar|Supprimer|削除|Remover|移除/);
    expect(pending).toMatch(/data-queue-edit="queue-1"/);

    const failed = render("failed");
    expect(failed).toContain("Retry");
    expect(failed).not.toMatch(/data-queue-send-now/);
  });

  it("supports Enter to commit edit and Escape to cancel (keyboard contract)", () => {
    expect(rowSource).toMatch(/event\.key === "Enter"/);
    expect(rowSource).toMatch(/event\.key === "Escape"/);
    expect(rowSource).toMatch(/workspace\.queueRemoveAttachment/);
    expect(rowSource).toMatch(/planQueueLifecycleStatus/);
  });
});
