/**
 * Engine Memory* updates (Phase 3.3).
 * Desk's store stays authoritative — these are suggestions / verify-context,
 * never silent writes.
 */

export type MemoryUpdateAction = "recalled" | "updated" | "other";

export type MemoryUpdateView = {
  action: MemoryUpdateAction;
  title: string | null;
  content: string | null;
};

export type MemoryEventLike = {
  kind?: string;
  type?: string;
  payload?: Record<string, unknown> | null;
  title?: string;
  action?: string;
  content?: string;
  text?: string;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function tokenBlob(event: MemoryEventLike): string {
  const p = rec(event.payload) ?? {};
  return [
    event.kind,
    event.type,
    event.title,
    event.action,
    p.title,
    p.sessionUpdate,
    p.action,
  ]
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();
}

export function isMemoryUpdateEvent(event: MemoryEventLike): boolean {
  const blob = tokenBlob(event);
  return (
    blob.includes("memory_update") ||
    blob.includes("memory_updated") ||
    blob.includes("memoryupdated") ||
    blob.includes("memory_recalled") ||
    blob.includes("memoryrecalled") ||
    blob.includes("memory_flush") ||
    blob.includes("memoryflush") ||
    blob.includes("memory_rewrite")
  );
}

export function memoryUpdateActionFromToken(token: string): MemoryUpdateAction {
  const t = token.toLowerCase().replace(/-/g, "_");
  if (t.includes("recall")) return "recalled";
  if (t.includes("update") || t.includes("rewrite")) return "updated";
  return "other";
}

export function foldMemoryUpdate(
  event: MemoryEventLike,
): MemoryUpdateView | null {
  if (!isMemoryUpdateEvent(event)) return null;
  const p = rec(event.payload) ?? {};
  const blob = tokenBlob(event);
  const action =
    memoryUpdateActionFromToken(blob) ||
    memoryUpdateActionFromToken(String(event.action ?? p.action ?? ""));
  const title =
    str(event.title) ??
    str(p.memoryTitle) ??
    str(p.title) ??
    str(p.name);
  const content =
    str(event.content) ??
    str(event.text) ??
    str(p.content) ??
    str(p.text) ??
    str(p.body) ??
    str(p.summary);
  if (title === "memory_update") {
    return { action, title: content ? content.slice(0, 80) : null, content };
  }
  return {
    action,
    title: title && title !== "memory_update" ? title : null,
    content,
  };
}

export function projectRecalledMemory(
  events: MemoryEventLike[],
): MemoryUpdateView[] {
  const out: MemoryUpdateView[] = [];
  for (const event of events) {
    const folded = foldMemoryUpdate(event);
    if (folded?.action === "recalled" && (folded.content || folded.title)) {
      out.push(folded);
    }
  }
  return out;
}

/** Engine-proposed memories to review — never auto-committed. */
export function projectUpdatedMemorySuggestions(
  events: MemoryEventLike[],
): MemoryUpdateView[] {
  const out: MemoryUpdateView[] = [];
  for (const event of events) {
    const folded = foldMemoryUpdate(event);
    if (folded?.action === "updated" && (folded.content || folded.title)) {
      out.push(folded);
    }
  }
  return out;
}
