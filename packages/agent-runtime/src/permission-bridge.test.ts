import { afterEach, describe, expect, it } from "vitest";
import {
  clearHumanPermissions,
  humanPermissionPendingCount,
  rejectHumanPermission,
  resolveHumanPermission,
  waitHumanPermission,
} from "./permission-bridge.js";

afterEach(() => {
  clearHumanPermissions();
});

describe("permission-bridge TTL", () => {
  it("times out a waiter that is never resolved", async () => {
    const pending = waitHumanPermission("req-ttl", 20);
    await expect(pending).rejects.toThrow(/permission_timeout/);
    expect(humanPermissionPendingCount()).toBe(0);
  });

  it("clears the waiter on resolve so it cannot leak", async () => {
    const pending = waitHumanPermission("req-ok", 5_000);
    resolveHumanPermission("req-ok", "allow");
    await expect(pending).resolves.toBe("allow");
    expect(humanPermissionPendingCount()).toBe(0);
  });

  it("clears the waiter on reject", async () => {
    const pending = waitHumanPermission("req-no", 5_000);
    rejectHumanPermission("req-no", "cancelled");
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(humanPermissionPendingCount()).toBe(0);
  });
});
