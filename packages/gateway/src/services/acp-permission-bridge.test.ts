import { describe, it, expect, beforeEach } from "vitest";
import {
  waitHumanPermission,
  resolveHumanPermission,
  clearHumanPermissions,
  humanPermissionPendingCount,
} from "@grokdesk/agent-runtime";

describe("human permission bridge (ACP ↔ runner)", () => {
  beforeEach(() => {
    clearHumanPermissions();
  });

  it("resolves waiters when runner approves", async () => {
    const p = waitHumanPermission("req-1");
    expect(humanPermissionPendingCount()).toBe(1);
    resolveHumanPermission("req-1", "allow");
    await expect(p).resolves.toBe("allow");
    expect(humanPermissionPendingCount()).toBe(0);
  });

  it("resolves deny on reject", async () => {
    const p = waitHumanPermission("req-2");
    resolveHumanPermission("req-2", "deny");
    await expect(p).resolves.toBe("deny");
  });
});
