import { describe, it, expect } from "vitest";
import {
  openTaskListState,
  openTaskWorkspaceState,
  shouldClearSelectionOnDelete,
  shouldSkipCancel,
} from "./task-navigation";

describe("task-navigation", () => {
  it("openTaskWorkspaceState sets workspace + tasks", () => {
    expect(openTaskWorkspaceState("t1")).toEqual({
      selectedId: "t1",
      taskSurface: "workspace",
      nav: "tasks",
      focusApprovalId: null,
    });
    expect(openTaskWorkspaceState("t1", { approvalId: "a9" })).toEqual({
      selectedId: "t1",
      taskSurface: "workspace",
      nav: "tasks",
      focusApprovalId: "a9",
    });
  });

  it("openTaskListState preserves or sets selection", () => {
    expect(openTaskListState()).toEqual({
      selectedId: null,
      taskSurface: "list",
      nav: "tasks",
    });
    expect(openTaskListState("x", "prev")).toEqual({
      selectedId: "x",
      taskSurface: "list",
      nav: "tasks",
    });
    expect(openTaskListState(undefined, "prev")).toEqual({
      selectedId: "prev",
      taskSurface: "list",
      nav: "tasks",
    });
  });

  it("skip cancel for optimistic ids", () => {
    expect(shouldSkipCancel("optimistic-1")).toBe(true);
    expect(shouldSkipCancel("real-id")).toBe(false);
  });

  it("clear selection only when chat was selected", () => {
    expect(shouldClearSelectionOnDelete(true)).toBe(true);
    expect(shouldClearSelectionOnDelete(false)).toBe(false);
  });
});
