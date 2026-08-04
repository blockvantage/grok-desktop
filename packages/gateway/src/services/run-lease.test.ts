import { describe, it, expect } from "vitest";
import { leaseHeartbeatMs, RUN_ATTEMPT_LEASE_MS } from "./run-lease.js";

describe("run-lease", () => {
  it("defaults to 60s", () => {
    expect(RUN_ATTEMPT_LEASE_MS).toBe(60_000);
    expect(leaseHeartbeatMs()).toBe(60_000);
    expect(leaseHeartbeatMs(0)).toBe(60_000);
    expect(leaseHeartbeatMs(30_000)).toBe(30_000);
  });
});
