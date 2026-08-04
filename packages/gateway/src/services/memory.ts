import { randomUUID } from "node:crypto";
import type { MemoryItem, MemoryKind } from "@grokdesk/shared";
import type { Db } from "../db.js";
import { LocalEmbedder, type Embedder } from "../embeddings/local.js";

export class MemoryService {
  private embedder: Embedder;

  constructor(
    private db: Db,
    embedder?: Embedder,
  ) {
    this.embedder = embedder ?? new LocalEmbedder();
  }

  list(kind?: MemoryKind, limit = 500): MemoryItem[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 2_000);
    const rows = (
      kind
        ? this.db
            .prepare(
              `SELECT * FROM memory_items WHERE kind = ? ORDER BY updated_at DESC LIMIT ?`,
            )
            .all(kind, lim)
        : this.db
            .prepare(
              `SELECT * FROM memory_items ORDER BY updated_at DESC LIMIT ?`,
            )
            .all(lim)
    ) as Record<string, unknown>[];
    return rows.map(rowToMemory);
  }

  upsert(input: {
    id?: string;
    kind: MemoryKind;
    title: string;
    content: string;
    projectId?: string | null;
    provenance?: string | null;
  }): MemoryItem {
    const now = new Date().toISOString();
    if (input.id) {
      const existing = this.db
        .prepare(`SELECT * FROM memory_items WHERE id = ?`)
        .get(input.id) as Record<string, unknown> | undefined;
      if (existing) {
        this.db
          .prepare(
            `UPDATE memory_items SET kind=?, title=?, content=?, project_id=?, provenance=?, updated_at=? WHERE id=?`,
          )
          .run(
            input.kind,
            input.title,
            input.content,
            input.projectId ?? null,
            input.provenance ?? null,
            now,
            input.id,
          );
        return this.get(input.id)!;
      }
    }
    const item: MemoryItem = {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      title: input.title,
      content: input.content,
      projectId: input.projectId ?? null,
      provenance: input.provenance ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO memory_items (id, kind, title, content, project_id, provenance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.kind,
        item.title,
        item.content,
        item.projectId,
        item.provenance,
        item.createdAt,
        item.updatedAt,
      );
    return item;
  }

  get(id: string): MemoryItem | null {
    const row = this.db
      .prepare(`SELECT * FROM memory_items WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToMemory(row) : null;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM memory_items WHERE id = ?`).run(id);
  }

  /**
   * Retrieve memory items relevant to a goal, bounded by rough char budget.
   */
  retrieve(goal: string, budgetChars = 4000): MemoryItem[] {
    const all = this.list();
    if (all.length === 0) return [];
    const q = this.embedder.embed(goal);
    const scored = all
      .map((item) => ({
        item,
        score: this.embedder.similarity(
          q,
          this.embedder.embed(`${item.title}\n${item.content}`),
        ),
      }))
      .sort((a, b) => b.score - a.score);

    const standing = all.filter((i) => i.kind === "standing" || i.kind === "now");
    const picked: MemoryItem[] = [];
    const seen = new Set<string>();
    let used = 0;

    for (const s of standing) {
      if (seen.has(s.id)) continue;
      const len = s.title.length + s.content.length;
      if (used + len > budgetChars) break;
      picked.push(s);
      seen.add(s.id);
      used += len;
    }
    for (const { item } of scored) {
      if (seen.has(item.id)) continue;
      const len = item.title.length + item.content.length;
      if (used + len > budgetChars) continue;
      picked.push(item);
      seen.add(item.id);
      used += len;
    }
    return picked;
  }

  formatPreamble(items: MemoryItem[]): string {
    if (items.length === 0) return "";
    return items
      .map((i) => `[${i.kind}] ${i.title}\n${i.content}`)
      .join("\n\n");
  }
}

function rowToMemory(r: Record<string, unknown>): MemoryItem {
  return {
    id: r.id as string,
    kind: r.kind as MemoryKind,
    title: r.title as string,
    content: r.content as string,
    projectId: (r.project_id as string | null) ?? null,
    provenance: (r.provenance as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}
