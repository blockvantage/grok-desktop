import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Db } from "../db.js";
import type {
  CreateTaskInput,
  PolicySnapshot,
  Task,
  TaskEvent,
  TaskEventKind,
  TaskStatus,
} from "@grokdesk/shared";
import { normalizeRoot } from "@grokdesk/shared";

function parseJsonObject(raw: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* corrupt */
  }
  return fallback;
}

function parseJsonArray(raw: unknown): unknown[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (Array.isArray(v)) return v;
  } catch {
    /* corrupt */
  }
  return [];
}

function rowToTask(row: Record<string, unknown>): Task {
  const attachmentsJson = row.attachments_json as string | null | undefined;
  const policySnapshot = parseJsonObject(row.policy_json, {
    approvalMode: "strict",
    workspaceRoots: [],
    allowNetworkTools: false,
    allowShell: false,
  }) as unknown as PolicySnapshot;
  let attachments: NonNullable<Task["attachments"]> | null = null;
  if (attachmentsJson) {
    const arr = parseJsonArray(attachmentsJson);
    attachments = arr as NonNullable<Task["attachments"]>;
  }
  return {
    id: row.id as string,
    goal: row.goal as string,
    title: (row.title as string | null) ?? null,
    mode: row.mode as Task["mode"],
    status: row.status as TaskStatus,
    model: row.model as string,
    effort: row.effort as Task["effort"],
    planFirst: Boolean(row.plan_first),
    policySnapshot,
    projectId: (row.project_id as string | null) ?? null,
    parentTaskId: (row.parent_task_id as string | null) ?? null,
    revisionOfTaskId: (row.revision_of_task_id as string | null) ?? null,
    conversationId: (row.conversation_id as string | null) ?? null,
    attachments,
    scheduleRuleId: (row.schedule_rule_id as string | null) ?? null,
    rolePack: (row.role_pack as string | null) ?? null,
    skills: parseJsonArray((row.skills_json as string) || "[]") as string[],
    mcpServerIds: parseJsonArray((row.mcp_json as string) || "[]") as string[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  } as unknown as Task;
}

export type TaskServiceHooks = {
  onTasksChanged?: () => void;
  onTaskEvent?: (taskId: string, seq: number) => void;
  /**
   * Fired after every durable event insert/coalesce (explicit hook — no
   * method monkey-patch). Used for declared-artifact persistence etc.
   */
  onEventAppended?: (event: TaskEvent) => void;
};

/** Ephemeral create-time fields not stored as DB columns (LANG-1 / CMD-4). */
type TaskPassThrough = { locale?: string; goalSource?: string };

export class TaskService {
  private paused = false;
  /** Process-local locale/goalSource so runner re-reads still see create params. */
  private passThroughByTaskId = new Map<string, TaskPassThrough>();

  constructor(
    private db: Db,
    private hooks: TaskServiceHooks = {},
  ) {}

  private applyPassThrough(task: Task): Task {
    const meta = this.passThroughByTaskId.get(task.id);
    if (!meta) return task;
    if (meta.locale !== undefined) task.locale = meta.locale;
    if (meta.goalSource !== undefined) task.goalSource = meta.goalSource;
    return task;
  }

  isPaused(): boolean {
    return this.paused;
  }

  pauseAll(): void {
    this.paused = true;
  }

  resumeAll(): void {
    this.paused = false;
  }

  create(input: CreateTaskInput, opts?: { emitHooks?: boolean }): Task {
    const now = new Date().toISOString();
    const roots = (input.workspaceRoots ?? []).map((r) => {
      const trimmed = typeof r === "string" ? r.trim() : "";
      if (!path.isAbsolute(trimmed)) {
        throw new Error(`workspace root must be absolute: ${r}`);
      }
      return normalizeRoot(path.resolve(trimmed));
    });
    if (roots.length === 0) {
      throw new Error(
        "workspaceRoots required (gateway should inject temp chat dir first)",
      );
    }
    const approvalMode = input.approvalMode ?? "balanced";
    // Conservative defaults: strict denies shell/network unless explicitly allowed.
    // Never silently force-allow (SEC-01); callers/UI must opt in.
    const allowShell =
      input.allowShell ??
      (approvalMode === "autopilot" || approvalMode === "balanced");
    const allowNetworkTools =
      input.allowNetworkTools ??
      (approvalMode === "autopilot" || approvalMode === "balanced");
    const policy: PolicySnapshot = {
      approvalMode,
      workspaceRoots: roots,
      allowNetworkTools,
      allowShell,
    };
    const task: Task = {
      id: randomUUID(),
      goal: input.goal,
      title: null,
      mode: input.mode ?? "interactive",
      status: "queued",
      model: input.model ?? "grok-4.5",
      effort: input.effort ?? "normal",
      planFirst: input.planFirst === true,
      policySnapshot: policy,
      projectId: input.projectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      revisionOfTaskId: input.revisionOfTaskId ?? null,
      attachments: (input.attachments ?? []).map((attachment) => ({
        ...attachment,
      })),
      scheduleRuleId: input.scheduleRuleId ?? null,
      rolePack: input.rolePack ?? null,
      skills: input.skills ?? [],
      mcpServerIds: input.mcpServerIds ?? [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.goalSource !== undefined
        ? { goalSource: input.goalSource }
        : {}),
    };

    // Validation and insert share one SQLite transaction. Even if two clients
    // race with different mutation ids, the second observes the first revision.
    this.db.transaction(() => {
      if (task.revisionOfTaskId) {
        this.validateRevisionCreate(task.parentTaskId, task.revisionOfTaskId);
      }
      this.db
        .prepare(
          `INSERT INTO tasks (
            id, goal, title, mode, status, model, effort, policy_json,
            project_id, parent_task_id, revision_of_task_id, attachments_json, schedule_rule_id, role_pack,
            skills_json, mcp_json, created_at, updated_at, completed_at, plan_first
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.goal,
          task.title,
          task.mode,
          task.status,
          task.model,
          task.effort,
          JSON.stringify(task.policySnapshot),
          task.projectId,
          task.parentTaskId,
          task.revisionOfTaskId,
          JSON.stringify(task.attachments ?? []),
          task.scheduleRuleId,
          task.rolePack,
          JSON.stringify(task.skills),
          JSON.stringify(task.mcpServerIds),
          task.createdAt,
          task.updatedAt,
          task.completedAt,
          task.planFirst ? 1 : 0,
        );
    })();

    if (input.locale || input.goalSource !== undefined) {
      this.passThroughByTaskId.set(task.id, {
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.goalSource !== undefined
          ? { goalSource: input.goalSource }
          : {}),
      });
    }

    this.appendEvent(
      task.id,
      "status_change",
      { status: "queued" },
      { emitHooks: opts?.emitHooks },
    );
    // Durable user-turn event so goalSource survives restarts for the bubble UI.
    if (input.goalSource !== undefined) {
      this.appendEvent(
        task.id,
        "message",
        {
          role: "user",
          text: task.goal,
          channel: "text",
          goalSource: input.goalSource,
        },
        { emitHooks: opts?.emitHooks },
      );
    }
    if (opts?.emitHooks !== false) this.hooks.onTasksChanged?.();
    return task;
  }

  /** Emit deferred create notifications after an outer acceptance commits. */
  emitTaskCreated(taskId: string): void {
    const event = this.listEvents(taskId).find(
      (candidate) =>
        candidate.kind === "status_change" &&
        candidate.payload.status === "queued",
    );
    if (event) {
      this.hooks.onTaskEvent?.(taskId, event.seq);
      this.hooks.onEventAppended?.(event);
    }
    this.hooks.onTasksChanged?.();
  }

  private validateRevisionCreate(
    parentTaskId: string | null,
    sourceTaskId: string,
  ): void {
    const source = this.db
      .prepare("SELECT id, status FROM tasks WHERE id = ?")
      .get(sourceTaskId) as { id: string; status: TaskStatus } | undefined;
    if (!source) throw new Error("Revision source task not found");
    if (parentTaskId !== sourceTaskId) {
      throw new Error("Revision parent must be the revision source task");
    }
    if (
      !new Set<TaskStatus>(["done", "failed", "cancelled"]).has(source.status)
    ) {
      throw new Error("Revision source must be terminal");
    }
    const existing = this.db
      .prepare("SELECT id FROM tasks WHERE revision_of_task_id = ? LIMIT 1")
      .get(sourceTaskId) as { id: string } | undefined;
    if (existing) throw new Error("Revision source was already revised");

    const rootId = this.rootOf(sourceTaskId);
    const latest = this.db
      .prepare(
        `WITH RECURSIVE thread(id) AS (
           SELECT ?
           UNION
           SELECT child.id
           FROM tasks AS child
           JOIN thread ON child.parent_task_id = thread.id
         )
         SELECT tasks.id
         FROM tasks JOIN thread ON tasks.id = thread.id
         ORDER BY tasks.created_at DESC, tasks.id DESC
         LIMIT 1`,
      )
      .get(rootId) as { id: string } | undefined;
    if (latest?.id !== sourceTaskId) {
      throw new Error("Revision source is not the latest accepted task");
    }
  }

  list(limit = 1_000): Task[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 5_000);
    const rows = this.db
      .prepare(
        "SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(lim) as Record<string, unknown>[];
    return rows.map((row) => this.applyPassThrough(rowToTask(row)));
  }

  get(taskId: string): Task | null {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId) as Record<string, unknown> | undefined;
    return row ? this.applyPassThrough(rowToTask(row)) : null;
  }

  /** Set the short display title for a chat (does not bump recency). */
  setTitle(taskId: string, title: string): Task {
    this.db
      .prepare("UPDATE tasks SET title = ? WHERE id = ?")
      .run(title.trim().slice(0, 120), taskId);
    this.hooks.onTasksChanged?.();
    const task = this.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  /** Resolve the root task id of a thread by walking parentTaskId up. */
  threadRootId(taskId: string): string {
    return this.rootOf(taskId);
  }

  /** Resolve the root task id of a thread by walking parentTaskId up. */
  private rootOf(taskId: string): string {
    let id = taskId;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(id)) break; // cycle guard
      seen.add(id);
      const row = this.db
        .prepare("SELECT parent_task_id FROM tasks WHERE id = ?")
        .get(id) as { parent_task_id: string | null } | undefined;
      if (!row || !row.parent_task_id) break;
      id = row.parent_task_id;
    }
    return id;
  }

  /** All tasks in the thread containing taskId (root + descendants). */
  collectThread(taskId: string): Task[] {
    const rootId = this.rootOf(taskId);
    const out: Task[] = [];
    const seen = new Set<string>();
    const frontier = [rootId];
    while (frontier.length) {
      const id = frontier.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = this.get(id);
      if (t) out.push(t);
      const kids = this.db
        .prepare("SELECT id FROM tasks WHERE parent_task_id = ?")
        .all(id) as { id: string }[];
      for (const k of kids) frontier.push(k.id);
    }
    return out;
  }

  /**
   * Delete an entire chat thread (root + follow-ups) and its rows in the
   * events/artifacts/audit tables. Returns the deleted tasks so the caller can
   * clean up their workspace folders on disk.
   */
  deleteThread(taskId: string): Task[] {
    const members = this.collectThread(taskId);
    const ids = members.map((m) => m.id);
    const run = this.db.transaction((memberIds: string[]) => {
      const evStmt = this.db.prepare(
        "DELETE FROM task_events WHERE task_id = ?",
      );
      const artStmt = this.db.prepare(
        "DELETE FROM artifacts WHERE task_id = ?",
      );
      const auditStmt = this.db.prepare(
        "DELETE FROM audit_entries WHERE task_id = ?",
      );
      const taskStmt = this.db.prepare("DELETE FROM tasks WHERE id = ?");
      for (const id of memberIds) {
        evStmt.run(id);
        artStmt.run(id);
        auditStmt.run(id);
        taskStmt.run(id);
      }
    });
    run(ids);
    this.hooks.onTasksChanged?.();
    return members;
  }

  /**
   * Mark a turn as rewound (cancelled + status event). Projector treats
   * `reason: "rewound"` as superseded so the calm stream collapses it.
   */
  markRewound(
    taskId: string,
    opts: { pointId: string; message?: string },
  ): Task | null {
    const task = this.get(taskId);
    if (!task) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`,
      )
      .run("cancelled", now, now, taskId);
    this.appendEvent(taskId, "status_change", {
      status: "cancelled",
      reason: "rewound",
      pointId: opts.pointId,
      message: opts.message ?? "Rewound to before this message",
    });
    this.hooks.onTasksChanged?.();
    return this.get(taskId);
  }

  setStatus(
    taskId: string,
    status: TaskStatus,
    opts?: { emitHooks?: boolean },
  ): Task {
    const now = new Date().toISOString();
    const completedAt =
      status === "done" || status === "failed" || status === "cancelled"
        ? now
        : null;
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`,
      )
      .run(status, now, completedAt, taskId);
    this.appendEvent(
      taskId,
      "status_change",
      { status },
      { emitHooks: opts?.emitHooks },
    );
    if (opts?.emitHooks !== false) this.hooks.onTasksChanged?.();
    const task = this.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  /** Compare-and-set lifecycle transition, composable inside outer txns. */
  transitionStatus(
    taskId: string,
    expected: readonly TaskStatus[],
    status: TaskStatus,
    opts?: { emitHooks?: boolean },
  ): Task | null {
    if (expected.length === 0) return null;
    const now = new Date().toISOString();
    const completedAt =
      status === "done" || status === "failed" || status === "cancelled"
        ? now
        : null;
    const placeholders = expected.map(() => "?").join(",");
    const info = this.db
      .prepare(
        `UPDATE tasks
         SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at)
         WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(status, now, completedAt, taskId, ...expected);
    if (info.changes === 0) return null;
    this.appendEvent(
      taskId,
      "status_change",
      { status },
      { emitHooks: opts?.emitHooks },
    );
    if (opts?.emitHooks !== false) this.hooks.onTasksChanged?.();
    return this.get(taskId);
  }

  /** Emit notifications after a status transition committed in an outer txn. */
  emitTaskStatusChanged(taskId: string, status: TaskStatus): void {
    const event = [...this.listEvents(taskId)]
      .reverse()
      .find(
        (candidate) =>
          candidate.kind === "status_change" &&
          candidate.payload.status === status,
      );
    if (event) {
      this.hooks.onTaskEvent?.(taskId, event.seq);
      this.hooks.onEventAppended?.(event);
    }
    this.hooks.onTasksChanged?.();
  }
  /** Emit hooks for an event inserted with emitHooks=false after commit. */
  emitDeferredEvent(event: TaskEvent): void {
    this.hooks.onTaskEvent?.(event.taskId, event.seq);
    this.hooks.onEventAppended?.(event);
  }

  appendEvent(
    taskId: string,
    kind: TaskEventKind,
    payload: Record<string, unknown>,
    opts?: { emitHooks?: boolean },
  ): TaskEvent {
    // Coalesce streaming text/thought token chunks into one row so the UI
    // does not get one card per word.
    if (kind === "message") {
      const channel = String(payload.channel ?? "text");
      const role = String(payload.role ?? "assistant");
      const chunk = String(payload.text ?? "");
      if (chunk) {
        const last = this.db
          .prepare(
            `SELECT id, seq, kind, payload_json, created_at FROM task_events
             WHERE task_id = ? ORDER BY seq DESC LIMIT 1`,
          )
          .get(taskId) as
          | {
              id: string;
              seq: number;
              kind: string;
              payload_json: string;
              created_at: string;
            }
          | undefined;
        if (last?.kind === "message") {
          try {
            const prev = JSON.parse(last.payload_json) as Record<
              string,
              unknown
            >;
            const prevChannel = String(prev.channel ?? "text");
            const prevRole = String(prev.role ?? "assistant");
            if (prevChannel === channel && prevRole === role) {
              // Cap coalesced message body so a runaway stream cannot grow a
              // single SQLite payload without bound (still streamable via seq).
              const MAX_MSG = 500_000;
              let nextText = String(prev.text ?? "") + chunk;
              if (nextText.length > MAX_MSG) {
                nextText = nextText.slice(nextText.length - MAX_MSG);
              }
              const merged = {
                ...prev,
                role,
                channel,
                text: nextText,
              };
              this.db
                .prepare(`UPDATE task_events SET payload_json = ? WHERE id = ?`)
                .run(JSON.stringify(merged), last.id);
              const coalesced: TaskEvent = {
                id: last.id,
                taskId,
                seq: last.seq,
                kind: "message",
                payload: merged,
                createdAt: last.created_at,
              };
              if (opts?.emitHooks !== false) {
                this.hooks.onTaskEvent?.(taskId, coalesced.seq);
                this.hooks.onEventAppended?.(coalesced);
              }
              return coalesced;
            }
          } catch {
            // fall through to insert
          }
        }
      }
    }

    // Transactional allocate+insert so concurrent writers cannot collide on seq.
    const event = this.db.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM task_events WHERE task_id = ?",
        )
        .get(taskId) as { maxSeq: number };
      const seq = (row?.maxSeq ?? 0) + 1;
      const ev: TaskEvent = {
        id: randomUUID(),
        taskId,
        seq,
        kind,
        payload,
        createdAt: new Date().toISOString(),
      };
      this.db
        .prepare(
          `INSERT INTO task_events (id, task_id, seq, kind, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ev.id,
          ev.taskId,
          ev.seq,
          ev.kind,
          JSON.stringify(ev.payload),
          ev.createdAt,
        );
      return ev;
    })();
    if (opts?.emitHooks !== false) {
      this.hooks.onTaskEvent?.(taskId, event.seq);
      this.hooks.onEventAppended?.(event);
    }
    return event;
  }

  listEvents(taskId: string, afterSeq = 0, limit = 2_000): TaskEvent[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 10_000);
    const rows = this.db
      .prepare(
        `SELECT * FROM task_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
      )
      .all(taskId, afterSeq, lim) as Record<string, unknown>[];
    return rows.map((r) => {
      let payload: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(r.payload_json ?? "{}")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        payload = { _corruptPayload: true };
      }
      return {
        id: r.id as string,
        taskId: r.task_id as string,
        seq: r.seq as number,
        kind: r.kind as TaskEventKind,
        payload,
        createdAt: r.created_at as string,
      };
    });
  }
}
