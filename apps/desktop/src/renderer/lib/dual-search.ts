/**
 * Pure search-state sync for App topbar vs list filters (Phase 6 extract).
 *
 * Phase 2: there is only one visible search field (topbar). taskSearch is
 * retained as a nav-scoped cache so tasks list filtering stays consistent
 * while the user is on Tasks — not a second input.
 */

/**
 * Mirror a topbar query into both global search and the tasks-scoped cache.
 */
export function dualSearchValue(value: string): {
  search: string;
  taskSearch: string;
} {
  return { search: value, taskSearch: value };
}

/**
 * Topbar controlled value: prefer taskSearch on tasks nav, else global search.
 */
export function topbarSearchValue(input: {
  nav: string;
  search: string;
  taskSearch: string;
}): string {
  return input.nav === "tasks" ? input.taskSearch || input.search : input.search;
}
