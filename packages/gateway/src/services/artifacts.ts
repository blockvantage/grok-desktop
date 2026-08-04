import { randomUUID } from "node:crypto";
import type { Artifact } from "@grokdesk/shared";
import type { Db } from "../db.js";

export class ArtifactService {
  constructor(private db: Db) {}

  create(input: {
    taskId: string;
    title: string;
    kind: Artifact["kind"];
    path: string | null;
    mimeType?: string | null;
  }): Artifact {
    const artifact: Artifact = {
      id: randomUUID(),
      taskId: input.taskId,
      title: input.title,
      kind: input.kind,
      path: input.path,
      mimeType: input.mimeType ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO artifacts (id, task_id, title, kind, path, mime_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.taskId,
        artifact.title,
        artifact.kind,
        artifact.path,
        artifact.mimeType,
        artifact.createdAt,
      );
    return artifact;
  }

  list(taskId?: string, limit = 500): Artifact[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 2_000);
    const rows = (
      taskId
        ? this.db
            .prepare(
              `SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(taskId, lim)
        : this.db
            .prepare(
              `SELECT * FROM artifacts ORDER BY created_at DESC LIMIT ?`,
            )
            .all(lim)
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      taskId: r.task_id as string,
      title: r.title as string,
      kind: r.kind as Artifact["kind"],
      path: (r.path as string | null) ?? null,
      mimeType: (r.mime_type as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  }
}
