/**
 * Pure nav transition side-effects for App shell (Phase 6 extract).
 */

import type { AppNavId } from "./app-shortcuts";

export type TaskSurface = "list" | "workspace";

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
