import { describe, it, expect } from "vitest";
import {
  chainFromIds,
  stampDetailWithCorrelation,
} from "./correlation-stamp.js";
import { newRequestCorrelation, withTask } from "@grokdesk/shared";

describe("correlation-stamp", () => {
  it("stamps missing correlation fields without overwriting detail", () => {
    const chain = withTask(newRequestCorrelation("req-9"), "task-9");
    const detail = stampDetailWithCorrelation(
      { tool: "shell", taskId: "keep-me" },
      { ...chain, runAttemptId: "att-1" },
    );
    expect(detail.tool).toBe("shell");
    expect(detail.taskId).toBe("keep-me"); // existing preserved
    expect(detail.requestId).toBe("req-9");
    expect(detail.runAttemptId).toBe("att-1");
  });

  it("chainFromIds only includes provided ids", () => {
    const c = chainFromIds({
      requestId: "r1",
      taskId: "t1",
      runAttemptId: null,
    });
    expect(c).toEqual({ requestId: "r1", taskId: "t1" });
    expect(JSON.stringify(c)).not.toMatch(/password|secret|token/i);
  });

  it("stamp is log-safe (ids only)", () => {
    const detail = stampDetailWithCorrelation(
      { action: "task.submit" },
      chainFromIds({
        requestId: "req-a",
        taskId: "task-b",
        runAttemptId: "att-c",
      }),
    );
    expect(detail).toEqual({
      action: "task.submit",
      requestId: "req-a",
      taskId: "task-b",
      runAttemptId: "att-c",
    });
  });
});
