import { describe, it, expect } from "vitest";
import {
  ENGINE_ENDED_WAITING_MESSAGE,
  isParkedWaitingStatus,
  providerPreflightDegradedReceipt,
  providerPreflightRejectReceipt,
  terminalAfterEngineRun,
} from "./provider-gate-receipts.js";

describe("provider-gate-receipts", () => {
  it("builds registry reject/degraded receipts", () => {
    const r = providerPreflightRejectReceipt("no shell");
    expect(r.decision).toBe("deny");
    expect(r.effect).toBe("rejected");
    expect(r.detail.source).toBe("provider_registry");
    expect(r.detail.message).toBe("no shell");

    const d = providerPreflightDegradedReceipt("degraded mode");
    expect(d.decision).toBe("info");
    expect(d.effect).toBe("degraded");
  });

  it("maps engine terminal outcome", () => {
    expect(terminalAfterEngineRun(false)).toEqual({
      status: "done",
      reason: "completed",
    });
    expect(terminalAfterEngineRun(true)).toEqual({
      status: "failed",
      reason: "engine_error",
    });
  });

  it("detects parked waiting statuses", () => {
    expect(isParkedWaitingStatus("waiting_approval")).toBe(true);
    expect(isParkedWaitingStatus("waiting_user")).toBe(true);
    expect(isParkedWaitingStatus("running")).toBe(false);
    expect(ENGINE_ENDED_WAITING_MESSAGE).toMatch(/approval/);
  });
});
