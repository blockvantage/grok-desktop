import { describe, expect, it } from "vitest";
import {
  isEntitlementFailClosed,
  requireGrokAdmission,
  requireGrokAdmissionSync,
} from "./entitlement-admission.js";
import { ENTITLEMENT_FAIL_CLOSED_ENV } from "./entitlement-composition.js";
import type { EntitlementGuard } from "./entitlement-guard.js";

describe("entitlement-admission (free Desk)", () => {
  it("isEntitlementFailClosed is always false (product license retired)", () => {
    expect(isEntitlementFailClosed({ [ENTITLEMENT_FAIL_CLOSED_ENV]: "1" })).toBe(
      false,
    );
    expect(isEntitlementFailClosed({ [ENTITLEMENT_FAIL_CLOSED_ENV]: "0" })).toBe(
      false,
    );
    expect(isEntitlementFailClosed({ GROKDESK_PACKAGED: "1" })).toBe(false);
    expect(isEntitlementFailClosed({})).toBe(false);
  });

  it("null guard always admits (no product-license fail-closed)", async () => {
    const env = { [ENTITLEMENT_FAIL_CLOSED_ENV]: "1", GROKDESK_PACKAGED: "1" };
    expect(() => requireGrokAdmissionSync(null, "interactive", env)).not.toThrow();
    await expect(
      requireGrokAdmission(null, "queued_execution", env),
    ).resolves.toBeUndefined();
  });

  it("present guard is still invoked for admission (runtime readiness)", async () => {
    let syncCalls = 0;
    let asyncCalls = 0;
    const guard = {
      assertCapabilitySync() {
        syncCalls += 1;
      },
      async assertCapability() {
        asyncCalls += 1;
      },
    } as unknown as EntitlementGuard;

    requireGrokAdmissionSync(guard, "interactive", {});
    await requireGrokAdmission(guard, "remote", {});
    expect(syncCalls).toBe(1);
    expect(asyncCalls).toBe(1);
  });
});
