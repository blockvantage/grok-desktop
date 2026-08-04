/**
 * Decide whether artifacts.list should harvest workspace deliverables first.
 */

export type TerminalishStatus = "done" | "failed" | "cancelled" | string;

/**
 * Harvest only for terminal tasks when a concrete taskId is requested.
 */
export function shouldHarvestDeliverablesOnList(
  taskId: string | undefined | null,
  status: TerminalishStatus | undefined | null,
): boolean {
  if (!taskId || !status) return false;
  return (
    status === "done" || status === "failed" || status === "cancelled"
  );
}
