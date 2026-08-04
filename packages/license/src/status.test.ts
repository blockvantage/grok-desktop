import { describe, expect, it } from "vitest";
import { deriveEntitlementState } from "./status.js";
import type { DeviceLeaseClaims } from "./lease.js";

function claims(partial?: Partial<DeviceLeaseClaims>): DeviceLeaseClaims {
  const iat = 1_700_000_000;
  return {
    iss: "https://entitlement.test",
    aud: "grok-desk",
    entitlementId: "ent-1",
    activationId: "act-1",
    deviceThumbprint: "thumb-1",
    productId: "grok-desk",
    capabilities: ["desk"],
    seatLimit: 3,
    updatePolicy: "lifetime_stable",
    iat,
    refreshAfter: iat + 86_400,
    exp: iat + 30 * 86_400,
    jti: "jti-1",
    ...partial,
  };
}

describe("deriveEntitlementState", () => {
  it("returns unactivated without claims", () => {
    const r = deriveEntitlementState({});
    expect(r).toEqual({
      ok: false,
      code: "invalid_key_format",
      state: "unactivated",
    });
  });

  it("returns active before refreshAfter", () => {
    const c = claims();
    const r = deriveEntitlementState({
      claims: c,
      nowSeconds: c.iat + 60,
    });
    expect(r).toEqual({ ok: true, claims: c, state: "active" });
  });

  it("returns refresh_due after refreshAfter and before exp", () => {
    const c = claims();
    const r = deriveEntitlementState({
      claims: c,
      nowSeconds: c.refreshAfter + 1,
    });
    expect(r).toEqual({ ok: true, claims: c, state: "refresh_due" });
  });

  it("network error preserves valid lease as offline_grace", () => {
    const c = claims();
    const r = deriveEntitlementState({
      claims: c,
      networkError: true,
      nowSeconds: c.iat + 60,
    });
    expect(r).toEqual({ ok: true, claims: c, state: "offline_grace" });
  });

  it("never extends exp on network error after expiry", () => {
    const c = claims();
    const r = deriveEntitlementState({
      claims: c,
      networkError: true,
      nowSeconds: c.exp + 1,
    });
    expect(r).toEqual({
      ok: false,
      code: "lease_expired",
      state: "lease_expired",
    });
  });

  it("authoritative denials map to desktop states", () => {
    const c = claims();
    expect(
      deriveEntitlementState({
        claims: c,
        denial: { code: "entitlement_suspended" },
      }).state,
    ).toBe("suspended");
    expect(
      deriveEntitlementState({
        claims: c,
        denial: { code: "seat_limit" },
      }),
    ).toMatchObject({ ok: false, code: "seat_limit", state: "seat_limit" });
    expect(
      deriveEntitlementState({
        claims: c,
        denial: { code: "device_deactivated" },
      }).state,
    ).toBe("device_deactivated");
  });
});
