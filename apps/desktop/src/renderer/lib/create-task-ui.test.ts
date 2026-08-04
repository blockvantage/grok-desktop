import { describe, it, expect } from "vitest";
import {
  createFailedNavState,
  makeOptimisticTaskId,
  optimisticCreateNavState,
  shouldBlockCreate,
} from "./create-task-ui";

describe("create-task-ui", () => {
  it("blocks when starting, empty goal, or runtime missing", () => {
    expect(shouldBlockCreate({ starting: true, goal: "x" })).toBe("starting");
    expect(shouldBlockCreate({ starting: false, goal: "  " })).toBe(
      "empty_goal",
    );
    expect(shouldBlockCreate({ starting: false, goal: "hi" })).toBeNull();
    expect(
      shouldBlockCreate({
        starting: false,
        goal: "hi",
        runtimeReady: false,
      }),
    ).toBe("runtime_missing");
    expect(
      shouldBlockCreate({
        starting: false,
        goal: "hi",
        runtimeReady: true,
      }),
    ).toBeNull();
    // Phase 3: intent mode may expand an empty composer
    expect(
      shouldBlockCreate({
        starting: false,
        goal: "",
        hasComposerIntent: true,
      }),
    ).toBeNull();
    expect(
      shouldBlockCreate({
        starting: false,
        goal: "",
        hasComposerIntent: false,
      }),
    ).toBe("empty_goal");
  });

  it("builds optimistic and failure nav states", () => {
    expect(optimisticCreateNavState("optimistic-1")).toEqual({
      selectedId: "optimistic-1",
      taskSurface: "workspace",
      nav: "tasks",
    });
    expect(createFailedNavState()).toEqual({
      selectedId: null,
      taskSurface: "list",
      nav: "home",
    });
  });

  it("makes optimistic ids", () => {
    expect(makeOptimisticTaskId(42, () => "uuid-1")).toBe(
      "optimistic-42-uuid-1",
    );
  });
});
