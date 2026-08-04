import { describe, it, expect } from "vitest";
import {
  cancelOutcomeFromTaskStatus,
  isNonGatewayTaskId,
} from "./cancel-outcome.js";

describe("cancel-outcome", () => {
  it("reports missing task", () => {
    expect(
      cancelOutcomeFromTaskStatus({ taskFound: false, wasActive: false }),
    ).toEqual({ ok: false, message: "task not found" });
  });

  it("ok when cancelled or was active", () => {
    expect(
      cancelOutcomeFromTaskStatus({
        taskFound: true,
        statusAfter: "cancelled",
        wasActive: false,
      }),
    ).toEqual({ ok: true });
    expect(
      cancelOutcomeFromTaskStatus({
        taskFound: true,
        statusAfter: "running",
        wasActive: true,
      }),
    ).toEqual({ ok: true });
  });

  it("notes already terminal", () => {
    expect(
      cancelOutcomeFromTaskStatus({
        taskFound: true,
        statusAfter: "done",
        wasActive: false,
      }),
    ).toEqual({ ok: true, message: "already terminal" });
  });

  it("detects optimistic/local ids", () => {
    expect(isNonGatewayTaskId("optimistic-abc")).toBe(true);
    expect(isNonGatewayTaskId("local-1")).toBe(true);
    expect(isNonGatewayTaskId("uuid-real")).toBe(false);
  });
});
