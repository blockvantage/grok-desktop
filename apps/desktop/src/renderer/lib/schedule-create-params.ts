/**
 * Pure schedule.create param assembly (Phase 6 extract).
 */

export type ScheduleCreateUiInput = {
  name: string;
  goal: string;
  cron: string;
  model: string;
};

/**
 * Build gateway schedule.create params from UI form + workspace root.
 * timezone resolved by caller (Intl) so tests stay pure.
 */
export function scheduleCreateParams(input: {
  form: ScheduleCreateUiInput;
  root: string;
  timezone: string;
}): {
  name: string;
  goalTemplate: string;
  cron: string;
  timezone: string;
  workspaceRoots: string[];
  model: string;
} {
  return {
    name: input.form.name,
    goalTemplate: input.form.goal,
    cron: input.form.cron,
    timezone: input.timezone.trim() || "UTC",
    workspaceRoots: [input.root],
    model: input.form.model,
  };
}
