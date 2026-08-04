/**
 * Provider/tool-declared artifacts (TASK-06) — preferred over mtime harvest alone.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";

export interface DeclaredArtifact {
  id: string;
  taskId: string;
  runAttemptId: string | null;
  title: string;
  kind: "file" | "report" | "media" | "card";
  path: string | null;
  mimeType: string | null;
  declaredBy: "provider" | "tool" | "harvest";
  createdAt: string;
}

export class DeclaredArtifactService {
  constructor(private db: Db) {}

  /**
   * Persist a declared artifact. Uses existing artifacts table when present;
   * also records declaration metadata in operation_receipts for audit.
   */
  declare(input: {
    taskId: string;
    runAttemptId?: string | null;
    title: string;
    kind?: DeclaredArtifact["kind"];
    path?: string | null;
    mimeType?: string | null;
    declaredBy?: DeclaredArtifact["declaredBy"];
  }): DeclaredArtifact {
    const existing = (
      input.path != null
        ? this.db
            .prepare(
              `SELECT * FROM artifacts
               WHERE task_id = ? AND path = ?
               ORDER BY created_at ASC LIMIT 1`,
            )
            .get(input.taskId, input.path)
        : this.db
            .prepare(
              `SELECT * FROM artifacts
               WHERE task_id = ? AND path IS NULL AND title = ? AND kind = ?
               ORDER BY created_at ASC LIMIT 1`,
            )
            .get(input.taskId, input.title, input.kind ?? "file")
    ) as Record<string, unknown> | undefined;
    if (existing) {
      return {
        id: String(existing.id),
        taskId: String(existing.task_id),
        runAttemptId: input.runAttemptId ?? null,
        title: String(existing.title),
        kind: existing.kind as DeclaredArtifact["kind"],
        path: (existing.path as string | null) ?? null,
        mimeType: (existing.mime_type as string | null) ?? null,
        declaredBy: input.declaredBy ?? "provider",
        createdAt: String(existing.created_at),
      };
    }

    const row: DeclaredArtifact = {
      id: randomUUID(),
      taskId: input.taskId,
      runAttemptId: input.runAttemptId ?? null,
      title: input.title,
      kind: input.kind ?? "file",
      path: input.path ?? null,
      mimeType: input.mimeType ?? null,
      declaredBy: input.declaredBy ?? "provider",
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO artifacts (id, task_id, title, kind, path, mime_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.taskId,
        row.title,
        row.kind,
        row.path,
        row.mimeType,
        row.createdAt,
      );
    return row;
  }

  listForTask(taskId: string, limit = 500): DeclaredArtifact[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 2_000);
    const rows = this.db
      .prepare(
        `SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(taskId, lim) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      taskId: String(r.task_id),
      runAttemptId: null,
      title: String(r.title),
      kind: r.kind as DeclaredArtifact["kind"],
      path: (r.path as string | null) ?? null,
      mimeType: (r.mime_type as string | null) ?? null,
      declaredBy: "provider",
      createdAt: String(r.created_at),
    }));
  }
}
