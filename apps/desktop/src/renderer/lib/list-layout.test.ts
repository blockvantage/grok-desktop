import { describe, expect, it } from "vitest";
import {
  isListRowActivateKey,
  taskListDensity,
  taskListGridClass,
  taskListShowsActivity,
  taskListShowsModel,
  TASK_LIST_COMPACT_MAX,
  TASK_LIST_NARROW_MAX,
} from "./list-layout";

describe("taskListDensity", () => {
  it("classifies viewport widths", () => {
    expect(taskListDensity(1200)).toBe("full");
    expect(taskListDensity(TASK_LIST_COMPACT_MAX - 1)).toBe("compact");
    expect(taskListDensity(TASK_LIST_NARROW_MAX - 1)).toBe("narrow");
    expect(taskListDensity(0)).toBe("full");
  });

  it("maps density to grid + column visibility", () => {
    expect(taskListGridClass("full")).toContain("100px_100px_100px");
    expect(taskListShowsModel("full")).toBe(true);
    expect(taskListShowsActivity("compact")).toBe(true);
    expect(taskListShowsModel("compact")).toBe(false);
    expect(taskListShowsActivity("narrow")).toBe(false);
    expect(taskListGridClass("narrow")).toContain("88px");
  });
});

describe("isListRowActivateKey", () => {
  it("accepts Enter and Space only", () => {
    expect(isListRowActivateKey("Enter")).toBe(true);
    expect(isListRowActivateKey(" ")).toBe(true);
    expect(isListRowActivateKey("Space")).toBe(false);
    expect(isListRowActivateKey("a")).toBe(false);
  });
});
