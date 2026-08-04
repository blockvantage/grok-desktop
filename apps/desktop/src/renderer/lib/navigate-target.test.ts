import { describe, it, expect } from "vitest";
import { anyLiveTasks, navigateTargetIntent } from "./navigate-target";

describe("navigateTargetIntent", () => {
  it("routes settings", () => {
    expect(navigateTargetIntent({ nav: "settings" })).toEqual({
      type: "settings",
      settingsTab: undefined,
    });
    expect(navigateTargetIntent({ settingsTab: "remote" })).toEqual({
      type: "settings",
      settingsTab: "remote",
    });
  });

  it("routes home/tasks", () => {
    expect(navigateTargetIntent({ nav: "home" })).toEqual({
      type: "nav",
      nav: "home",
    });
    expect(navigateTargetIntent({ nav: "tasks" })).toEqual({
      type: "nav",
      nav: "tasks",
    });
  });

  it("ignores unknown", () => {
    expect(navigateTargetIntent({ nav: "memory" })).toEqual({ type: "none" });
  });
});

describe("anyLiveTasks", () => {
  it("detects active statuses", () => {
    const isActive = (s: string) => s === "running";
    expect(anyLiveTasks([{ status: "done" }, { status: "running" }], isActive)).toBe(
      true,
    );
    expect(anyLiveTasks([{ status: "done" }], isActive)).toBe(false);
  });
});
