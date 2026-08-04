/**
 * Derive greeting counters from task/schedule lists (Phase 6 extract from App).
 */

export type TaskStatusLike = { status: string };
export type ScheduleLike = { enabled?: boolean };

export type GreetingStats = {
  total: number;
  running: number;
  done: number;
  enabledSchedules: number;
};

/**
 * Count tasks and enabled schedules for the home greeting.
 * `isActive` injected so callers share the same active-status definition.
 */
export function greetingStatsFromLists(
  tasks: TaskStatusLike[],
  schedules: ScheduleLike[],
  isActive: (status: string) => boolean,
): GreetingStats {
  return {
    total: tasks.length,
    running: tasks.filter((t) => isActive(t.status)).length,
    done: tasks.filter((t) => t.status === "done").length,
    enabledSchedules: schedules.filter((s) => s.enabled).length,
  };
}

/**
 * Display name for greeting from auth fields.
 */
export function greetingNameFromAuth(auth: {
  accountName?: string | null;
  accountLabel?: string | null;
} | null | undefined): string {
  return auth?.accountName ?? auth?.accountLabel ?? "";
}
