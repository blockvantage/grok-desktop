/**
 * Auto-compact as a calm inline marker (Phase 2.4).
 * Never presents the protocol token or a JSON envelope.
 */

export const COMPACTION_PHASES = ["started", "completed", "failed"] as const;
export type CompactionPhase = (typeof COMPACTION_PHASES)[number];

export type CompactionMarker = {
  phase: CompactionPhase;
  /** Optional human summary of what was compacted, if the engine sent one. */
  summary: string | null;
};

export type CompactionEventLike = {
  kind?: string;
  payload?: Record<string, unknown> | null;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Map a protocol / step token onto a compaction phase. Unknown → null. */
export function compactionPhaseFromToken(token: string): CompactionPhase | null {
  const t = token.trim().toLowerCase().replace(/-/g, "_");
  if (!t) return null;
  if (
    t.startsWith("compact_started") ||
    t.includes("auto_compact_started") ||
    t.includes("auto_compact_start") ||
    t.includes("autocompactstarted")
  ) {
    return "started";
  }
  if (
    t.startsWith("compact_failed") ||
    t.includes("auto_compact_failed") ||
    t.includes("autocompactfailed")
  ) {
    return "failed";
  }
  if (
    t.startsWith("compact_completed") ||
    t.includes("auto_compact_completed") ||
    t.includes("auto_compact_end") ||
    t === "auto_compact" ||
    t.includes("autocompactcompleted")
  ) {
    return "completed";
  }
  return null;
}

export function isCompactionEvent(event: CompactionEventLike): boolean {
  const p = rec(event.payload) ?? {};
  const title = str(p.title) || str(p.message) || str(p.type) || str(p.sessionUpdate);
  return compactionPhaseFromToken(title) != null;
}

/**
 * Latest compaction marker in a turn's events. Started without a later
 * completed/failed still shows as in-progress.
 */
export function projectCompactionMarker(
  events: readonly CompactionEventLike[],
): CompactionMarker | null {
  let latest: CompactionMarker | null = null;
  for (const event of events) {
    const p = rec(event.payload) ?? {};
    const token =
      str(p.title) ||
      str(p.message) ||
      str(p.type) ||
      str(p.sessionUpdate) ||
      str(event.kind);
    const phase = compactionPhaseFromToken(token);
    if (!phase) continue;
    const fromTitle = str(p.title);
    const colon = fromTitle.indexOf(":");
    const titleSummary =
      colon > 0 ? fromTitle.slice(colon + 1).trim() : "";
    const summary =
      str(p.summary) ||
      str(p.transcript) ||
      str(p.detail) ||
      titleSummary ||
      null;
    latest = { phase, summary: summary || null };
  }
  return latest;
}
