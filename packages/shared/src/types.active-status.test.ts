import { describe, expect, it } from "vitest";
import {
  ACTIVE_TASK_STATUSES,
  isActiveTaskStatus,
  TASK_STATUSES,
  type TaskStatus,
} from "./types.js";

const TERMINAL: TaskStatus[] = ["done", "failed", "cancelled"];

describe("isActiveTaskStatus", () => {
  it("matches TaskStatus union minus terminals", () => {
    const expected = TASK_STATUSES.filter((s) => !TERMINAL.includes(s));
    expect([...ACTIVE_TASK_STATUSES].sort()).toEqual([...expected].sort());
  });

  it("returns true for every active status", () => {
    for (const s of ACTIVE_TASK_STATUSES) {
      expect(isActiveTaskStatus(s)).toBe(true);
    }
  });

  it("returns false for terminals and unknown values", () => {
    for (const s of TERMINAL) {
      expect(isActiveTaskStatus(s)).toBe(false);
    }
    expect(isActiveTaskStatus(undefined)).toBe(false);
    expect(isActiveTaskStatus(null)).toBe(false);
    expect(isActiveTaskStatus("")).toBe(false);
    expect(isActiveTaskStatus("bogus")).toBe(false);
  });
});
