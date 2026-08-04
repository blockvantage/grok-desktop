import { describe, it, expect } from "vitest";
import {
  desktopTaskIdParam,
  desktopTaskSetGrantParams,
} from "./desktop-task-params.js";

describe("desktopTaskIdParam", () => {
  it("string taskId", () => {
    expect(desktopTaskIdParam({ taskId: "t1" })).toBe("t1");
    expect(desktopTaskIdParam({})).toBe("");
  });
});

describe("desktopTaskSetGrantParams", () => {
  it("null without taskId", () => {
    expect(desktopTaskSetGrantParams({ granted: true })).toBeNull();
  });

  it("maps fields", () => {
    expect(
      desktopTaskSetGrantParams({
        taskId: "t1",
        granted: 1,
        displayId: "main",
      }),
    ).toEqual({
      taskId: "t1",
      granted: true,
      displayId: "main",
    });
  });
});
