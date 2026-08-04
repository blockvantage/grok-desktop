/**
 * Topbar search placeholder by active nav (Phase 6 extract).
 */

export type TopbarNav =
  | "home"
  | "tasks"
  | "scheduled"
  | "artifacts"
  | "memory"
  | "settings"
  | string;

/**
 * Pick localized placeholder key for the current nav surface.
 * Returns the already-translated string from a lookup map.
 */
export function topbarSearchPlaceholder(
  nav: TopbarNav,
  labels: {
    tasks: string;
    artifacts: string;
    memory: string;
    scheduled: string;
    default: string;
  },
): string {
  switch (nav) {
    case "tasks":
      return labels.tasks;
    case "artifacts":
      return labels.artifacts;
    case "memory":
      return labels.memory;
    case "scheduled":
      return labels.scheduled;
    default:
      return labels.default;
  }
}
