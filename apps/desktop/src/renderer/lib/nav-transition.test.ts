import { describe, it, expect } from "vitest";
import { navChangeSideEffects, newChatNavState } from "./nav-transition";

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
