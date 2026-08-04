/**
 * Build a tasks.create goal string with optional note / voice parity fields (P3).
 * Phone cannot stage desktop file paths; notes and voice transcripts fold into the goal.
 */

/** Match desktop CreateTaskInputSchema goal max (packages/shared ipc). */
export const COMPOSE_GOAL_MAX_CHARS = 100_000;

export function composeTaskGoal(input: {
  goal: string;
  note?: string;
  voiceTranscript?: string;
}): string {
  const parts: string[] = [];
  const goal = input.goal.trim().slice(0, COMPOSE_GOAL_MAX_CHARS);
  if (goal) parts.push(goal);
  const voice = input.voiceTranscript?.trim().slice(0, 32_000);
  if (voice) parts.push(`[Voice note]\n${voice}`);
  const note = input.note?.trim().slice(0, 32_000);
  if (note) parts.push(`[Attachment note]\n${note}`);
  return parts.join("\n\n").trim().slice(0, COMPOSE_GOAL_MAX_CHARS);
}
