/**
 * Pure nav transition side-effects for App shell (Phase 6 extract).
 * Task list/workspace selection lives in task-navigation and is re-exported
 * here so App can treat this module as the nav/route surface.
 */

import type { AppNavId } from "./app-shortcuts";
import type { TaskSurface } from "./task-navigation";

export type { TaskSurface, TaskNavState } from "./task-navigation";
export {
  openTaskListState,
  openTaskWorkspaceState,
  shouldClearSelectionOnDelete,
  shouldSkipCancel,
} from "./task-navigation";

/**
 * When changing primary nav, clear search fields; force list surface when
 * leaving the tasks section.
 */
export function navChangeSideEffects(
  id: AppNavId,
): {
  clearSearch: boolean;
  clearTaskSearch: boolean;
  forceListSurface: boolean;
} {
  return {
    clearSearch: true,
    clearTaskSearch: true,
    forceListSurface: id !== "tasks",
  };
}

/**
 * Home / new-chat shell reset.
 */
export function newChatNavState(): {
  nav: "home";
  selectedId: null;
  taskSurface: TaskSurface;
  goal: "";
} {
  return {
    nav: "home",
    selectedId: null,
    taskSurface: "list",
    goal: "",
  };
}

/** Keep list surface while highlighting a task row. */
export function selectTaskInList(id: string): {
  selectedId: string;
  taskSurface: "list";
} {
  return { selectedId: id, taskSurface: "list" };
}
