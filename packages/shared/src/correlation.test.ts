import { describe, it, expect } from "vitest";
import {
  correlationLogFields,
  newRequestCorrelation,
  withOperation,
  withRunAttempt,
  withTask,
} from "./correlation.js";

describe("correlation chain", () => {
  it("builds a bounded chain without secrets", () => {
    let c = newRequestCorrelation("req-1");
    c = withTask(c, "task-1");
    c = withRunAttempt(c, "attempt-1");
    c = withOperation(c, "op-1");
    const fields = correlationLogFields(c);
    expect(fields).toEqual({
      requestId: "req-1",
      taskId: "task-1",
      runAttemptId: "attempt-1",
      operationId: "op-1",
    });
    expect(JSON.stringify(fields)).not.toMatch(/password|token|secret/i);
  });
});
