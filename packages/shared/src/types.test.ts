import { describe, it, expect } from "vitest";
import {
  TASK_STATUSES,
  APPROVAL_MODES,
  EFFORT_LEVELS,
  isTaskStatus,
} from "./types.js";

describe("domain types", () => {
  it("includes waiting_approval status", () => {
    expect(TASK_STATUSES).toContain("waiting_approval");
  });

  it("validates task status", () => {
    expect(isTaskStatus("running")).toBe(true);
    expect(isTaskStatus("nope")).toBe(false);
  });

  it("defines three approval modes", () => {
    expect(APPROVAL_MODES).toEqual(["strict", "balanced", "autopilot"]);
  });

  it("defines effort levels", () => {
    expect(EFFORT_LEVELS).toEqual(["fast", "normal", "heavy", "max"]);
  });
});
