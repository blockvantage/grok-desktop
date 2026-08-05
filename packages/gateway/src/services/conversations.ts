/**
 * Conversation / turn model for follow-up context across restart (TASK-02).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";

export interface Conversation {
  id: string;
  title: string | null;
  providerId: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Turn {
  id: string;
  conversationId: string;
  taskId: string | null;
  parentTurnId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  providerSessionId: string | null;
  contextStrategy: "provider_session" | "transcript_fallback" | null;
  modelId: string | null;
  providerId: string | null;
  createdAt: string;
}

export class ConversationService {
  constructor(private db: Db) {}

  create(input?: {
    title?: string | null;
    providerId?: string;
    modelId?: string | null;
  }): Conversation {
    const now = new Date().toISOString();
    const row: Conversation = {
      id: randomUUID(),
      title: input?.title ?? null,
      providerId: input?.providerId ?? "grok",
      modelId: input?.modelId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, provider_id, model_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.title,
        row.providerId,
        row.modelId,
        row.createdAt,
        row.updatedAt,
      );
    return row;
  }

  get(id: string): Conversation | null {
    const r = this.db
      .prepare(`SELECT * FROM conversations WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return r ? rowToConv(r) : null;
  }

  /**
   * Ensure a conversation for a task chain: reuse parent conversation or create.
   */
  ensureForTask(opts: {
    taskId: string;
    parentTaskId?: string | null;
    modelId?: string | null;
    providerId?: string;
  }): Conversation {
    return this.db.transaction(() => {
      const own = this.db
        .prepare(`SELECT conversation_id as cid FROM tasks WHERE id = ?`)
        .get(opts.taskId) as { cid: string | null } | undefined;
      if (own?.cid) {
        const existing = this.get(own.cid);
        if (existing) return existing;
      }

      if (opts.parentTaskId) {
        const parent = this.db
          .prepare(`SELECT conversation_id as cid FROM tasks WHERE id = ?`)
          .get(opts.parentTaskId) as { cid: string | null } | undefined;
        if (parent?.cid) {
          const existing = this.get(parent.cid);
          if (existing) {
            this.linkTask(opts.taskId, existing.id);
            return existing;
          }
        }
      }

      const conv = this.create({
        providerId: opts.providerId ?? "grok",
        modelId: opts.modelId ?? null,
      });
      this.linkTask(opts.taskId, conv.id);
      return conv;
    })();
  }

  linkTask(taskId: string, conversationId: string): void {
    this.db
      .prepare(
        `UPDATE tasks SET conversation_id = ?, provider_id = COALESCE(provider_id, 'grok') WHERE id = ?`,
      )
      .run(conversationId, taskId);
  }

  appendTurn(input: {
    conversationId: string;
    taskId?: string | null;
    parentTurnId?: string | null;
    role: Turn["role"];
    content: string;
    providerSessionId?: string | null;
    contextStrategy?: Turn["contextStrategy"];
    modelId?: string | null;
    providerId?: string | null;
    createdAt?: string;
    /** Reconciliation may replace an earlier provisional assistant result. */
    replaceExisting?: boolean;
  }): Turn {
    const turn: Turn = {
      id: randomUUID(),
      conversationId: input.conversationId,
      taskId: input.taskId ?? null,
      parentTurnId: input.parentTurnId ?? null,
      role: input.role,
      content: input.content,
      providerSessionId: input.providerSessionId ?? null,
      contextStrategy: input.contextStrategy ?? null,
      modelId: input.modelId ?? null,
      providerId: input.providerId ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO turns (
          id, conversation_id, task_id, parent_turn_id, role, content,
          provider_session_id, context_strategy, model_id, provider_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turn.id,
        turn.conversationId,
        turn.taskId,
        turn.parentTurnId,
        turn.role,
        turn.content,
        turn.providerSessionId,
        turn.contextStrategy,
        turn.modelId,
        turn.providerId,
        turn.createdAt,
      );
    if (
      info.changes === 0 &&
      turn.taskId &&
      (turn.role === "user" || turn.role === "assistant")
    ) {
      let existing = this.db
        .prepare(
          `SELECT * FROM turns
           WHERE task_id = ? AND role = ?
           ORDER BY created_at ASC, id ASC LIMIT 1`,
        )
        .get(turn.taskId, turn.role) as Record<string, unknown> | undefined;
      if (
        existing &&
        (String(existing.conversation_id) !== turn.conversationId ||
          (turn.role === "assistant" && input.replaceExisting === true))
      ) {
        this.db
          .prepare(
            `UPDATE turns
             SET conversation_id = ?, content = ?, parent_turn_id = ?,
                 provider_session_id = ?, context_strategy = ?,
                 model_id = ?, provider_id = ?, created_at = ?
             WHERE id = ?`,
          )
          .run(
            turn.conversationId,
            turn.content,
            turn.parentTurnId,
            turn.providerSessionId,
            turn.contextStrategy,
            turn.modelId,
            turn.providerId,
            turn.createdAt,
            String(existing.id),
          );
        existing = this.db
          .prepare("SELECT * FROM turns WHERE id = ?")
          .get(String(existing.id)) as Record<string, unknown> | undefined;
      }
      if (existing) return rowToTurn(existing);
    }
    this.db
      .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
      .run(turn.createdAt, turn.conversationId);
    return turn;
  }

  listTurns(conversationId: string, limit = 2_000): Turn[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 10_000);
    const rows = this.db
      .prepare(
        `SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(conversationId, lim) as Record<string, unknown>[];
    return rows.map(rowToTurn);
  }

  hasUserTurn(taskId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS present
         FROM tasks
         JOIN turns
           ON turns.task_id = tasks.id
          AND turns.role = 'user'
          AND turns.conversation_id = tasks.conversation_id
         WHERE tasks.id = ?
         LIMIT 1`,
      )
      .get(taskId) as { present: number } | undefined;
    return row?.present === 1;
  }

  /**
   * Deterministic bounded transcript for providers without session resume.
   */
  buildTranscriptFallback(
    conversationId: string,
    opts?: { maxChars?: number; throughTaskId?: string },
  ): string {
    const maxChars = opts?.maxChars ?? 12_000;
    if (maxChars <= 0) return "";
    const allTurns = this.listTurns(conversationId);
    let cutoffIndex = allTurns.length - 1;
    if (opts?.throughTaskId) {
      cutoffIndex = -1;
      for (let index = allTurns.length - 1; index >= 0; index -= 1) {
        if (allTurns[index]?.taskId === opts.throughTaskId) {
          cutoffIndex = index;
          break;
        }
      }
    }
    const turns = cutoffIndex >= 0 ? allTurns.slice(0, cutoffIndex + 1) : [];
    const parts: string[] = [];
    let total = 0;
    // Prefer most recent turns when over budget.
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]!;
      const block = `${t.role.toUpperCase()}: ${t.content}\n`;
      if (total + block.length > maxChars) {
        if (parts.length === 0) parts.unshift(block.slice(0, maxChars));
        break;
      }
      parts.unshift(block);
      total += block.length;
    }
    return parts.join("\n").trim().slice(0, maxChars);
  }

  setProviderSession(
    taskId: string,
    providerSessionId: string,
    providerId = "grok",
  ): void {
    this.db
      .prepare(
        `UPDATE tasks SET provider_session_id = ?, provider_id = ? WHERE id = ?`,
      )
      .run(providerSessionId, providerId, taskId);
  }
}

function rowToConv(r: Record<string, unknown>): Conversation {
  return {
    id: String(r.id),
    title: (r.title as string | null) ?? null,
    providerId: String(r.provider_id ?? "grok"),
    modelId: (r.model_id as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToTurn(r: Record<string, unknown>): Turn {
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    taskId: (r.task_id as string | null) ?? null,
    parentTurnId: (r.parent_turn_id as string | null) ?? null,
    role: r.role as Turn["role"],
    content: String(r.content),
    providerSessionId: (r.provider_session_id as string | null) ?? null,
    contextStrategy: (r.context_strategy as Turn["contextStrategy"]) ?? null,
    modelId: (r.model_id as string | null) ?? null,
    providerId: (r.provider_id as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}
