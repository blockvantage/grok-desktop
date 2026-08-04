/**
 * Pure nav state after a successful follow-up task create (Phase 6 extract).
 */

export function followUpSuccessNavState(taskId: string): {
  selectedId: string;
  taskSurface: "workspace";
  nav: "tasks";
} {
  return {
    selectedId: taskId,
    taskSurface: "workspace",
    nav: "tasks",
  };
}
