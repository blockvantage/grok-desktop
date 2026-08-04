import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import type { AuditEntry } from "@grokdesk/shared";

export class AuditService {
  constructor(private db: Db) {}

  append(
    entry: Omit<AuditEntry, "id" | "createdAt"> & { createdAt?: string },
  ): AuditEntry {
    const full: AuditEntry = {
      id: randomUUID(),
      createdAt: entry.createdAt ?? new Date().toISOString(),
      taskId: entry.taskId,
      action: entry.action,
      detail: entry.detail,
      decision: entry.decision,
    };
    this.db
      .prepare(
        `INSERT INTO audit_entries (id, task_id, action, detail_json, decision, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.id,
        full.taskId,
        full.action,
        JSON.stringify(full.detail),
        full.decision,
        full.createdAt,
      );
    return full;
  }
}
