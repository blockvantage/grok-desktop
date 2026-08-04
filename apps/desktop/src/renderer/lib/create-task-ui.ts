/**
 * Pure UI state transitions for optimistic create / failure (Phase 6 extract).
 */

export type TaskSurface = "list" | "workspace";

/**
 * Navigation after optimistic placeholder is inserted.
 */
export function optimisticCreateNavState(optimisticId: string): {
  selectedId: string;
  taskSurface: TaskSurface;
  nav: "tasks";
} {
  return {
    selectedId: optimisticId,
    taskSurface: "workspace",
    nav: "tasks",
  };
}

/**
 * Navigation after create fails (roll back to home composer).
 */
export function createFailedNavState(): {
  selectedId: null;
  taskSurface: TaskSurface;
  nav: "home";
} {
  return {
    selectedId: null,
    taskSurface: "list",
    nav: "home",
  };
}

/**
 * Whether create should no-op (empty goal, already starting, or no Grok runtime).
 * When runtimeReady is explicitly false, Run is hard-blocked until install.
 */
export function shouldBlockCreate(input: {
  starting: boolean;
  goal: string;
  /** When false, Grok engine/runtime is missing — block create. */
  runtimeReady?: boolean;
  /**
   * Phase 3: structured intent mode can expand an empty textarea into a
   * full template goal at send time.
   */
  hasComposerIntent?: boolean;
}): "starting" | "empty_goal" | "runtime_missing" | null {
  if (input.starting) return "starting";
  if (!input.goal.trim() && !input.hasComposerIntent) return "empty_goal";
  if (input.runtimeReady === false) return "runtime_missing";
  return null;
}

/**
 * Unique optimistic/mutation id. The clock keeps it readable while UUID
 * entropy prevents collisions across windows, processes, and clock rollback.
 */
export function makeOptimisticTaskId(
  nowMs: number = Date.now(),
  createEntropy: () => string = () => globalThis.crypto.randomUUID(),
): string {
  return `optimistic-${nowMs}-${createEntropy()}`;
}
