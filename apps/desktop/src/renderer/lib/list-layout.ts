/**
 * Responsive layout helpers for dense lists (tasks, etc.).
 * Pure so column collapse rules are unit-tested without React.
 */

export type TaskListDensity = "full" | "compact" | "narrow";

/** Breakpoints (CSS px) matching Tailwind sm/md intent for the tasks grid. */
export const TASK_LIST_COMPACT_MAX = 900;
export const TASK_LIST_NARROW_MAX = 640;

export function taskListDensity(viewportWidth: number): TaskListDensity {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return "full";
  if (viewportWidth < TASK_LIST_NARROW_MAX) return "narrow";
  if (viewportWidth < TASK_LIST_COMPACT_MAX) return "compact";
  return "full";
}

/**
 * Tailwind-friendly grid template for the tasks table.
 * narrow: task + status + menu
 * compact: task + status + activity + menu
 * full: task + status + model + activity + menu
 */
export function taskListGridClass(density: TaskListDensity): string {
  switch (density) {
    case "narrow":
      return "grid-cols-[1fr_88px_40px]";
    case "compact":
      return "grid-cols-[1fr_100px_100px_40px]";
    default:
      return "grid-cols-[1fr_100px_100px_100px_40px]";
  }
}

export function taskListShowsModel(density: TaskListDensity): boolean {
  return density === "full";
}

export function taskListShowsActivity(density: TaskListDensity): boolean {
  return density === "full" || density === "compact";
}

/** Whether a keyboard event should activate a list row (Enter or Space). */
export function isListRowActivateKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
