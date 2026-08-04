/**
 * One clear search owner per view — avoid competing global + view-local fields.
 *
 * Phase 2 rule: never stack shell topbar search and a view-local search Input
 * on the same screen. List views are filtered by the topbar query; Home and
 * Settings hide list search entirely (⌘K remains for command palette).
 */

export type SearchOwner = "topbar" | "local" | "none";

/**
 * Who owns search for the active nav surface.
 * - topbar: shell field filters the active list (artifacts/tasks/memory/scheduled)
 * - local: reserved if a view must own its own field (none today)
 * - none: no list search field (home/settings)
 */
export function searchOwnerForNav(nav: string): SearchOwner {
  switch (nav) {
    case "artifacts":
    case "tasks":
    case "memory":
    case "scheduled":
      return "topbar";
    case "home":
    case "settings":
      return "none";
    default:
      return "topbar";
  }
}

/** Whether the view should render its own search input. Always false today. */
export function shouldShowViewLocalSearch(nav: string): boolean {
  return searchOwnerForNav(nav) === "local";
}

/** Whether the shell topbar should show the search field for this nav. */
export function shouldShowTopbarSearch(nav: string): boolean {
  return searchOwnerForNav(nav) === "topbar";
}
