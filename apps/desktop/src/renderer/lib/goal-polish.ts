/**
 * Goal polish — turn vague coworker asks into clearer, actionable prompts.
 * Pure heuristics (no LLM) for instant composer assist.
 */

export type GoalPolishResult = {
  original: string;
  polished: string;
  /** Whether polish changed the text meaningfully. */
  changed: boolean;
  hints: string[];
};

const VAGUE = [
  /^(help|fix|do|make|write|check|look|see|update|handle)\s+(this|it|that|stuff|things)\b/i,
  /^(please\s+)?(do something|work on this|figure it out)\b/i,
  /^(idk|todo|tbd)\b/i,
];

/**
 * Light rewrite: ensure goal has a verb + object, add deliverable hint when missing.
 */
export function polishGoal(raw: string): GoalPolishResult {
  const original = raw.trim();
  if (!original) {
    return {
      original,
      polished: "",
      changed: false,
      hints: ["Describe a concrete outcome Grok should produce."],
    };
  }

  const hints: string[] = [];
  let text = original.replace(/\s+/g, " ").trim();

  // Capitalize first letter.
  text = text.charAt(0).toUpperCase() + text.slice(1);

  // Ensure ends with period for multi-sentence clarity (not questions).
  if (!/[.!?]$/.test(text) && text.length > 40) {
    text = text + ".";
  }

  const lower = text.toLowerCase();
  const vague = VAGUE.some((re) => re.test(lower));
  if (vague) {
    hints.push("Be specific about the outcome, files, and constraints.");
  }

  const hasDeliverable =
    /\b(save|write|create|export|draft|generate|produce|document|spreadsheet|markdown|pdf|email|summary|brief)\b/i.test(
      text,
    );
  if (!hasDeliverable && text.length < 120) {
    text = `${text.replace(/[.!?]?$/, "")}. Leave a clear deliverable in the workspace.`;
    hints.push("Added a deliverable expectation so results are tangible.");
  }

  const hasScope =
    /\b(folder|file|repo|project|this workspace|in \.\/|under )\b/i.test(text);
  if (!hasScope && text.length < 160) {
    hints.push("Mention a folder or file when project context matters.");
  }

  const changed = text !== original;
  return { original, polished: text, changed, hints };
}

/** Suggest whether the polish chip should appear. */
export function shouldOfferGoalPolish(goal: string): boolean {
  const g = goal.trim();
  if (g.length < 6 || g.length > 500) return false;
  const p = polishGoal(g);
  return p.changed || p.hints.length > 0;
}
