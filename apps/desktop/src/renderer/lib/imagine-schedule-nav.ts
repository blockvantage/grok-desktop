/**
 * Pure nav intents for imagine / schedule handoffs from task workspace (Phase 6).
 */

export function imagineFromTaskNavState(goal: string): {
  goal: string;
  nav: "home";
} {
  return { goal, nav: "home" };
}

export function scheduleFromTaskNavState(goalTemplate: string): {
  goal: string;
  nav: "scheduled";
} {
  return { goal: goalTemplate, nav: "scheduled" };
}

/**
 * Seed value for ScheduledView create-form goal field.
 * Trims; empty draft leaves the form blank (user types manually).
 */
export function seedScheduleFormGoal(
  initialGoal?: string | null,
): string {
  return (initialGoal ?? "").trim();
}
