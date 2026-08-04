import { describe, it, expect } from "vitest";
import { recoveryFromErrorMessage } from "./error-recovery.js";

const t = (k: string) => k;

describe("recoveryFromErrorMessage", () => {
  it("maps usage_pool_exhausted to billing CTAs", () => {
    const v = recoveryFromErrorMessage("usage_pool_exhausted", t);
    expect(v.kind).toBe("usage_exhausted");
    expect(v.primary?.action).toBe("openBilling");
    expect(v.title).toBe("recovery.usageExhaustedTitle");
  });

  it("maps reauth", () => {
    const v = recoveryFromErrorMessage("please log in", t);
    expect(v.kind).toBe("needs_reauth");
    expect(v.primary?.action).toBe("signIn");
  });

  it("maps rate limit as dismiss", () => {
    const v = recoveryFromErrorMessage("Rate limited", t);
    expect(v.kind).toBe("rate_limited");
  });

  it("offers a retry action for generic/unclassified errors (no dead-end)", () => {
    const v = recoveryFromErrorMessage("some unclassified failure", t);
    expect(v.kind).toBe("generic");
    expect(v.primary?.action).toBe("retry");
    expect(v.primary?.label).toBe("recovery.retry");
  });
});
