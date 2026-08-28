/**
 * Sidebar roster row projection (Phase 3.4).
 */
import {
  lastTurnSummaryFromText,
  rosterActivityFromStatus,
  type RosterActivity,
} from "@grokdesk/shared";

export function rosterRowView(input: {
  latestGoal: string;
  status: string;
  needsInput?: boolean;
}): {
  activity: RosterActivity;
  lastTurnSummary: string | null;
} {
  return {
    activity: rosterActivityFromStatus({
      status: input.status,
      needsInput: input.needsInput,
    }),
    lastTurnSummary: lastTurnSummaryFromText(input.latestGoal),
  };
}

export function rosterActivityLabelKey(activity: RosterActivity): string {
  return `roster.activity.${activity}`;
}
