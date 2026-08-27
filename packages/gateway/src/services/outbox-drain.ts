/**
 * Global gateway outbox drain: FIFO per conversation, concurrent across chats.
 * Submits through the existing tasks.create acceptance path only.
 */
import fs from "node:fs";
import type { ConversationOutboxItem, CreateTaskInput, Task } from "@grokdesk/shared";
import type { ConversationOutboxRepository } from "./conversation-outbox.js";
import type { Db } from "../db.js";
import {
  buildDrainedCreateInput,
  loadFollowUpSettings,
} from "./follow-up-settings.js";

const ACTIVE_TASK_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_user",
] as const;

export type OutboxDrainCreateResult = {
  task: Task;
  kind: "fresh" | "duplicate" | "continue";
};

export type OutboxDrainDeps = {
  outbox: ConversationOutboxRepository;
  db: Db;
  /**
   * Crash-atomic tasks.create acceptance. Must use clientMutationId === item.id.
   * Never a second acceptance kernel.
   */
  createFollowUp: (
    input: CreateTaskInput & { clientMutationId: string },
  ) => OutboxDrainCreateResult | Promise<OutboxDrainCreateResult>;
  /** Global concurrency cap across conversations (running + about-to-start). */
  maxConcurrentConversations?: number;
  /** Count currently running tasks for capacity. */
  countActiveRuns?: () => number;
  notifyOutboxChanged?: (payload: {
    conversationId?: string;
    itemIds?: string[];
    reason?: string;
  }) => void;
  /** Optional content-free metric sink. */
  emitMetric?: (metric: {
    name: string;
    conversationId?: string;
    itemId?: string;
    status?: string;
    attemptCount?: number;
    durationMs?: number;
    outcome?: string;
  }) => void;
  now?: () => number;
  /** Transient classification; permanent errors mark failed without auto-spin. */
  isTransientError?: (err: unknown) => boolean;
  /** Attachment path existence check. */
  attachmentExists?: (sourcePath: string) => boolean;
};

export function defaultIsTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/auth|sign.?in|unauthorized|forbidden|policy|validation|invalid|capacity|full|not found|ENOENT|missing/i.test(msg)) {
    return false;
  }
  if (/timeout|ECONN|ENOTFOUND|temporar|busy|locked|SQLITE_BUSY|network|5\d\d/i.test(msg)) {
    return true;
  }
  return false;
}

/**
 * Pure: whether a conversation may claim its next outbox row.
 */
export function conversationMayDrain(input: {
  hasActiveTask: boolean;
  hasSubmittingClaim: boolean;
}): boolean {
  return !input.hasActiveTask && !input.hasSubmittingClaim;
}

/**
 * Query SQLite for non-terminal tasks bound to a conversation.
 */
export function conversationHasActiveTask(
  db: Db,
  conversationId: string,
): boolean {
  const placeholders = ACTIVE_TASK_STATUSES.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT id FROM tasks
       WHERE conversation_id = ?
         AND status IN (${placeholders})
       LIMIT 1`,
    )
    .get(conversationId, ...ACTIVE_TASK_STATUSES) as { id: string } | undefined;
  if (row) return true;

  // Legacy fallback: tasks without conversation_id still serialize by parent root
  // when outbox parent_task_id is in their ancestry chain is handled at claim time
  // via parentTaskId active check.
  return false;
}

export function parentTaskIsActive(db: Db, parentTaskId: string): boolean {
  const placeholders = ACTIVE_TASK_STATUSES.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT id FROM tasks
       WHERE id = ?
         AND status IN (${placeholders})
       LIMIT 1`,
    )
    .get(parentTaskId, ...ACTIVE_TASK_STATUSES) as { id: string } | undefined;
  return Boolean(row);
}

/**
 * Coalescing drain coordinator: one pump at a time; schedule() merges triggers.
 */
export class OutboxDrainCoordinator {
  private pumping = false;
  private pending = false;
  private stopped = false;
  private pumpPromise: Promise<void> | null = null;

  constructor(private readonly deps: OutboxDrainDeps) {}

  /** Coalesced trigger — safe from enqueue, terminal task, retry, startup. */
  schedule(): void {
    if (this.stopped) return;
    if (this.pumping) {
      this.pending = true;
      return;
    }
    void this.runPump();
  }

  /**
   * Await in-flight pump (gateway shutdown before DB close).
   * Completes the current pump fully, then rejects further schedule().
   */
  async join(): Promise<void> {
    // Let the active pump finish its conversation scan first so we do not
    // abandon claimed work mid-loop. Then stop further schedules.
    if (this.pumpPromise) await this.pumpPromise;
    this.stopped = true;
    // A trailing pending re-schedule may have started after the await.
    while (this.pumpPromise) {
      await this.pumpPromise;
    }
  }

  private async runPump(): Promise<void> {
    this.pumping = true;
    this.pumpPromise = this.pumpLoop();
    try {
      await this.pumpPromise;
    } finally {
      this.pumping = false;
      this.pumpPromise = null;
      if (this.pending && !this.stopped) {
        this.pending = false;
        this.schedule();
      }
    }
  }

  private async pumpLoop(): Promise<void> {
    const { outbox, db } = this.deps;
    const isTransient =
      this.deps.isTransientError ?? defaultIsTransientError;
    const attachmentExists =
      this.deps.attachmentExists ?? ((p: string) => fs.existsSync(p));

    try {
      outbox.releaseExpiredClaims();
    } catch {
      /* best-effort */
    }

    const maxConc = this.deps.maxConcurrentConversations ?? 3;
    const conversationIds = outbox.listConversationIdsWithPending();

    for (const conversationId of conversationIds) {
      if (this.stopped) break;

      const activeRuns = this.deps.countActiveRuns?.() ?? 0;
      if (activeRuns >= maxConc) break;

      if (conversationHasActiveTask(db, conversationId)) continue;

      // Peek oldest pending without claiming yet for attachment check.
      const pending = outbox
        .list({ conversationId })
        .find((i) => i.status === "pending");
      if (!pending) continue;

      if (parentTaskIsActive(db, pending.parentTaskId)) continue;

      // Missing attachments: block this item only; continue other conversations.
      const missing = pending.attachments.find(
        (a) => a.sourcePath && !attachmentExists(a.sourcePath),
      );
      if (missing) {
        outbox.markBlockedMissingAttachment(pending.id, "missing_attachment");
        this.deps.notifyOutboxChanged?.({
          conversationId,
          itemIds: [pending.id],
          reason: "blocked_missing_attachment",
        });
        this.deps.emitMetric?.({
          name: "outbox_drain",
          conversationId,
          itemId: pending.id,
          status: "blocked_missing_attachment",
          outcome: "blocked",
        });
        continue;
      }

      const claimed = outbox.claimNext(conversationId);
      if (!claimed) continue;

      const started = (this.deps.now ?? Date.now)();
      try {
        const settings = loadFollowUpSettings(db, {
          parentTaskId: claimed.parentTaskId,
          conversationId,
        });
        const createInput: CreateTaskInput & { clientMutationId: string } =
          buildDrainedCreateInput(claimed, settings);
        const result = await this.deps.createFollowUp(createInput);
        const accepted = outbox.markAccepted(claimed.id, result.task.id);
        this.deps.notifyOutboxChanged?.({
          conversationId,
          itemIds: [claimed.id],
          reason: "accepted",
        });
        this.deps.emitMetric?.({
          name: "outbox_drain",
          conversationId,
          itemId: claimed.id,
          status: "accepted",
          attemptCount: claimed.attemptCount,
          durationMs: (this.deps.now ?? Date.now)() - started,
          outcome: result.kind,
        });
        void accepted;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? "error");
        if (isTransient(err)) {
          // Release claim so a later pump retries with backoff via lease.
          // Leave as failed with transient reason for visibility; retry path
          // returns to pending. Prefer re-pending after short lease expire.
          outbox.markFailed(claimed.id, `transient:${msg.slice(0, 200)}`);
          // Immediately re-queue transient for bounded retry (attempt_count already bumped).
          if (claimed.attemptCount < 5) {
            try {
              outbox.retry(claimed.id);
            } catch {
              /* keep failed */
            }
          }
        } else {
          outbox.markFailed(claimed.id, msg.slice(0, 2_000));
        }
        this.deps.notifyOutboxChanged?.({
          conversationId,
          itemIds: [claimed.id],
          reason: "failed",
        });
        this.deps.emitMetric?.({
          name: "outbox_drain",
          conversationId,
          itemId: claimed.id,
          status: "failed",
          attemptCount: claimed.attemptCount,
          durationMs: (this.deps.now ?? Date.now)() - started,
          outcome: isTransient(err) ? "transient" : "permanent",
        });
      }
    }

    try {
      outbox.pruneTerminalReceipts();
    } catch {
      /* best-effort */
    }
  }
}

/** Test helper: one synchronous drain tick. */
export async function drainOnce(deps: OutboxDrainDeps): Promise<void> {
  const c = new OutboxDrainCoordinator(deps);
  c.schedule();
  await c.join();
}

export type { ConversationOutboxItem };
