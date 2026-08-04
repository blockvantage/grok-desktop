import type { MemoryItem, ScheduleRule } from "./types.js";

export interface AutomationSuggestion {
  /** Stable id for dedupe (not inbox uuid) */
  suggestionKey: string;
  title: string;
  body: string;
  /** Draft schedule fields the UI/gateway can create from */
  draftSchedule: {
    name: string;
    goalTemplate: string;
    /** Human cron expression */
    cron: string;
    timezone: string;
  };
  sourceMemoryIds: string[];
}

export type StandingLike = Pick<MemoryItem, "id" | "kind" | "title" | "content">;

/**
 * Deterministic, memory-aware automation suggestions (no LLM).
 * SOTA-lite: standing/profile/preference → suggested recurring work.
 */
export function suggestAutomationsFromMemory(
  memories: StandingLike[],
  existingRules: Pick<ScheduleRule, "name" | "goalTemplate" | "enabled">[] = [],
): AutomationSuggestion[] {
  const relevant = memories.filter((m) =>
    ["standing", "profile", "preference", "project", "brand"].includes(m.kind),
  );
  if (relevant.length === 0) return [];

  const blob = relevant
    .map((m) => `${m.title}\n${m.content}`)
    .join("\n")
    .toLowerCase();

  const suggestions: AutomationSuggestion[] = [];
  const existingText = existingRules
    .map((r) => `${r.name} ${r.goalTemplate}`.toLowerCase())
    .join(" | ");

  const pushUnique = (s: AutomationSuggestion) => {
    const needle = s.draftSchedule.name.toLowerCase();
    if (existingText.includes(needle)) return;
    if (suggestions.some((x) => x.suggestionKey === s.suggestionKey)) return;
    suggestions.push(s);
  };

  const ids = relevant.map((m) => m.id);

  // Weekly review if planning / priorities language present
  if (
    /priorit|weekly|focus|chief of staff|plan|okrs?|goals?/.test(blob) ||
    relevant.some((m) => /plan|priority|standing/i.test(m.title))
  ) {
    pushUnique({
      suggestionKey: "weekly-priority-review",
      title: "Automate a weekly priority review",
      body: "Based on your standing context, schedule a short weekly review that lists open priorities and blockers.",
      draftSchedule: {
        name: "Weekly priority review",
        goalTemplate:
          "Review standing priorities and open loops. Produce a short weekly plan with top 3 priorities, blockers, and next actions.",
        cron: "0 9 * * 1",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
      sourceMemoryIds: ids,
    });
  }

  // Marketing cadence
  if (/brand|campaign|marketing|launch|audience|copy|positioning/.test(blob)) {
    pushUnique({
      suggestionKey: "weekly-marketing-pulse",
      title: "Automate a weekly marketing pulse",
      body: "Your memory mentions brand or campaigns — suggest a weekly pulse for channel ideas and copy drafts.",
      draftSchedule: {
        name: "Weekly marketing pulse",
        goalTemplate:
          "Using brand and project memory, draft this week's marketing pulse: 3 channel ideas, one primary message, and a short checklist.",
        cron: "0 10 * * 2",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
      sourceMemoryIds: ids,
    });
  }

  // Research / competitive
  if (/research|competitor|market|scan|sources?/.test(blob)) {
    pushUnique({
      suggestionKey: "biweekly-research-scan",
      title: "Automate a biweekly research scan",
      body: "Standing research interests detected — schedule a light biweekly scan into a structured note.",
      draftSchedule: {
        name: "Biweekly research scan",
        goalTemplate:
          "Run a lightweight research scan on standing topics. Separate facts vs inference; write research-brief.md with sources.",
        // Semi-monthly (1st & 15th). Avoid `*/14` which is month-anchored weirdly.
        cron: "0 11 1,15 * *",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
      sourceMemoryIds: ids,
    });
  }

  // Always offer a gentle daily standup if profile exists but nothing matched
  if (suggestions.length === 0 && relevant.some((m) => m.kind === "profile")) {
    pushUnique({
      suggestionKey: "daily-focus-nudge",
      title: "Automate a daily focus check-in",
      body: "Profile memory is set — a short daily focus prompt can keep work aligned without spam.",
      draftSchedule: {
        name: "Daily focus check-in",
        goalTemplate:
          "From profile and standing memory, propose today's single highest-leverage focus and one optional stretch item.",
        cron: "0 8 * * 1-5",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
      sourceMemoryIds: ids,
    });
  }

  return suggestions;
}
