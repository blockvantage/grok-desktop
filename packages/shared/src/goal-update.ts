/**
 * GoalUpdated fold for header/tray (Phase 2.5). Locale-free: UI adds copy.
 */

export type GoalProgressFields = {
  objective: string | null;
  progress: string | null;
};

export type GoalEventLike = {
  kind?: string;
  payload?: Record<string, unknown> | null;
};

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function foldGoalProgressFields(
  events: readonly GoalEventLike[],
): GoalProgressFields {
  let objective: string | null = null;
  let progress: string | null = null;
  for (const event of events) {
    const p = rec(event.payload) ?? {};
    const title = str(p.title) ?? "";
    const kind = String(event.kind ?? "");
    const token = `${kind} ${title} ${str(p.sessionUpdate) ?? ""}`.toLowerCase();
    const isGoal =
      kind === "goal_update" ||
      kind === "goal" ||
      title.toLowerCase().includes("goal") ||
      token.includes("goalupdated") ||
      token.includes("goal_updated");
    if (!isGoal) continue;
    const obj = str(p.objective ?? p.goal ?? (title === "goal_update" ? null : p.title));
    const st = str(p.progress ?? p.message ?? p.statusText);
    if (obj) objective = obj;
    if (st && st !== "start" && st !== "end") progress = st;
  }
  return { objective, progress };
}

/** Tray/header-safe one-liner: objective — progress. */
export function formatGoalProgressLine(fields: GoalProgressFields): string | null {
  if (fields.objective && fields.progress) {
    return `${fields.objective} — ${fields.progress}`;
  }
  return fields.objective ?? fields.progress;
}
