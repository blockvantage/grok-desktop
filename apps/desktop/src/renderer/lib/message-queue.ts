/**
 * Follow-up message queue while a turn is still running.
 * Pure helpers so the queue behavior is unit-tested without React.
 */

import {
  attachmentKindForName,
  type TaskAttachment,
} from "@grokdesk/shared";

export type QueuedMessageStatus = "pending" | "sending" | "failed";

export type QueuedMessage = {
  id: string;
  text: string;
  createdAt: string;
  /** Optional attachment paths already staged */
  attachmentPaths?: string[];
  /** pending = waiting; sending = claimed; failed = last attempt rejected */
  status?: QueuedMessageStatus;
};

/** Claim a pending item so only one send path can own it. */
export function claimQueuedMessage(
  queue: QueuedMessage[],
  id: string,
): { next: QueuedMessage[]; item: QueuedMessage | null } {
  const item = queue.find((m) => m.id === id) ?? null;
  if (!item || item.status === "sending") {
    return { next: queue, item: null };
  }
  if (item.status === "failed") {
    // Must retry explicitly via markQueuedPending first.
    return { next: queue, item: null };
  }
  return {
    next: queue.map((m) =>
      m.id === id ? { ...m, status: "sending" as const } : m,
    ),
    item: { ...item, status: "sending" },
  };
}

export function editQueuedMessage(
  queue: QueuedMessage[],
  id: string,
  patch: { text?: string; attachmentPaths?: string[] | undefined },
): QueuedMessage[] {
  return queue.map((m) => {
    if (m.id !== id) return m;
    if (m.status === "sending") return m;
    const text = patch.text !== undefined ? patch.text.trim() : m.text;
    if (!text) return m;
    return {
      ...m,
      text,
      attachmentPaths:
        patch.attachmentPaths !== undefined
          ? patch.attachmentPaths.length
            ? [...patch.attachmentPaths]
            : undefined
          : m.attachmentPaths,
      status: m.status === "failed" ? ("pending" as const) : m.status,
    };
  });
}

export function createQueuedMessage(
  text: string,
  attachmentPaths?: string[],
  now: Date = new Date(),
): QueuedMessage {
  const trimmed = text.trim();
  return {
    id: `q-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    text: trimmed,
    createdAt: now.toISOString(),
    status: "pending",
    attachmentPaths:
      attachmentPaths && attachmentPaths.length > 0
        ? [...attachmentPaths]
        : undefined,
  };
}

export function enqueueMessage(
  queue: QueuedMessage[],
  item: QueuedMessage,
  max = 20,
): QueuedMessage[] {
  if (!item.text) return queue;
  const next = [...queue, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function removeQueuedMessage(
  queue: QueuedMessage[],
  id: string,
): QueuedMessage[] {
  return queue.filter((m) => m.id !== id);
}

/** Pop the head of the queue (FIFO). */
export function dequeueMessage(
  queue: QueuedMessage[],
): { next: QueuedMessage[]; item: QueuedMessage | null } {
  if (queue.length === 0) return { next: queue, item: null };
  const [item, ...rest] = queue;
  return { next: rest, item: item ?? null };
}

/** Force: take a specific id to the front and pop it. */
export function forceDequeueMessage(
  queue: QueuedMessage[],
  id: string,
): { next: QueuedMessage[]; item: QueuedMessage | null } {
  const item = queue.find((m) => m.id === id) ?? null;
  if (!item) return { next: queue, item: null };
  return {
    next: queue.filter((m) => m.id !== id),
    item,
  };
}

export function markQueuedFailed(
  queue: QueuedMessage[],
  id: string,
): QueuedMessage[] {
  return queue.map((m) =>
    m.id === id ? { ...m, status: "failed" as const } : m,
  );
}

export function markQueuedPending(
  queue: QueuedMessage[],
  id: string,
): QueuedMessage[] {
  return queue.map((m) =>
    m.id === id ? { ...m, status: "pending" as const } : m,
  );
}

/** Next item eligible for auto-drain (skips failed/sending). */
export function nextDrainableMessage(
  queue: QueuedMessage[],
): QueuedMessage | null {
  return (
    queue.find((m) => m.status !== "failed" && m.status !== "sending") ?? null
  );
}

/**
 * Rebuild TaskAttachment[] from stored paths for onFollowUp.
 * `{ sourcePath }` is enough — the gateway stages on create.
 */
export function attachmentsFromQueuedPaths(
  paths?: string[],
): TaskAttachment[] | undefined {
  if (!paths?.length) return undefined;
  return paths.map((sourcePath) => {
    const name = sourcePath.split(/[/\\]/).pop() || "file";
    return {
      id: `qatt-${sourcePath}`,
      name,
      sourcePath,
      kind: attachmentKindForName(name),
    };
  });
}

/**
 * Attempt to send one queued item. Does not mutate the queue — callers
 * remove on success or mark failed on rejection.
 */
export async function sendQueuedMessage(
  item: QueuedMessage,
  onFollowUp: (
    text: string,
    attachments?: TaskAttachment[],
  ) => void | Promise<boolean | void>,
): Promise<"sent" | "failed"> {
  const attachments = attachmentsFromQueuedPaths(item.attachmentPaths);
  try {
    const ok = await Promise.resolve(onFollowUp(item.text, attachments));
    return ok === false ? "failed" : "sent";
  } catch {
    return "failed";
  }
}
