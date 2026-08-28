import { describe, it, expect } from "vitest";
import {
  taskIdParam,
  tasksSetTitleParams,
  tasksApproveParams,
} from "./task-rpc-params.js";

describe("taskIdParam", () => {
  it("stringifies taskId", () => {
    expect(taskIdParam({ taskId: "t1" })).toBe("t1");
    expect(taskIdParam({})).toBe("");
  });
});

describe("tasksSetTitleParams", () => {
  it("requires taskId and string title", () => {
    expect(
      tasksSetTitleParams({ taskId: "t1", title: "Hello" }),
    ).toEqual({ taskId: "t1", title: "Hello", resetToAuto: false });
    expect(tasksSetTitleParams({ taskId: "t1" })).toBeNull();
    expect(tasksSetTitleParams({ title: "x" })).toBeNull();
  });

  it("allows empty title when resetToAuto", () => {
    expect(
      tasksSetTitleParams({ taskId: "t1", resetToAuto: true }),
    ).toEqual({ taskId: "t1", title: "", resetToAuto: true });
  });
});

describe("tasksApproveParams", () => {
  it("accepts approve/reject only", () => {
    expect(
      tasksApproveParams({ approvalId: "a1", decision: "approve" }),
    ).toEqual({ approvalId: "a1", decision: "approve", remember: false });
    expect(
      tasksApproveParams({
        approvalId: "a1",
        decision: "approve",
        remember: true,
      }),
    ).toEqual({ approvalId: "a1", decision: "approve", remember: true });
    expect(
      tasksApproveParams({ approvalId: "a1", decision: "maybe" }),
    ).toBeNull();
    expect(tasksApproveParams({ decision: "approve" })).toBeNull();
  });
});
