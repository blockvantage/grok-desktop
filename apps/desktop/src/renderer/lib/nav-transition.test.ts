import { describe, it, expect } from "vitest";
import {
  navChangeSideEffects,
  newChatNavState,
  openTaskListState,
  openTaskWorkspaceState,
  selectTaskInList,
} from "./nav-transition";

describe("navChangeSideEffects", () => {
  it("forces list when leaving tasks", () => {
    expect(navChangeSideEffects("home").forceListSurface).toBe(true);
    expect(navChangeSideEffects("tasks").forceListSurface).toBe(false);
  });

  it("always clears search fields", () => {
    const e = navChangeSideEffects("settings");
    expect(e.clearSearch).toBe(true);
    expect(e.clearTaskSearch).toBe(true);
  });
});

describe("newChatNavState", () => {
  it("resets to home list composer", () => {
    expect(newChatNavState()).toEqual({
      nav: "home",
      selectedId: null,
      taskSurface: "list",
      goal: "",
    });
  });
});

describe("task-selection helpers (re-exported nav module)", () => {
  it("opens workspace and list surfaces", () => {
    expect(openTaskWorkspaceState("t1")).toMatchObject({
      selectedId: "t1",
      taskSurface: "workspace",
      nav: "tasks",
    });
    expect(openTaskListState("t1", "prev")).toEqual({
      selectedId: "t1",
      taskSurface: "list",
      nav: "tasks",
    });
    expect(selectTaskInList("t9")).toEqual({
      selectedId: "t9",
      taskSurface: "list",
    });
  });
});
