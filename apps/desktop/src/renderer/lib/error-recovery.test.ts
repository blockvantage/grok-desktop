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
    expect(v.body).toBe("some unclassified failure");
  });

  it("splits 429-style limits into capacity, team, and free banners", () => {
    const capacity = recoveryFromErrorMessage(
      "429 capacity overloaded, try again later",
      t,
    );
    expect(capacity.kind).toBe("rate_limited_capacity");
    expect(capacity.title).toBe("recovery.rateLimitedCapacityTitle");
    expect(capacity.primary?.action).toBe("retry");

    const team = recoveryFromErrorMessage(
      "team limit reached for this workspace",
      t,
    );
    expect(team.kind).toBe("rate_limited_team");
    expect(team.body).toBe("recovery.rateLimitedTeamBody");

    const free = recoveryFromErrorMessage("free tier usage allowance exhausted", t);
    expect(free.kind).toBe("rate_limited_free");
    expect(free.primary?.action).toBe("openBilling");
  });

  it("never dumps JSON or stacks into the generic banner", () => {
    const v = recoveryFromErrorMessage(
      '{"error":"nope","code":-32601,"jsonrpc":"2.0"}',
      t,
    );
    expect(v.kind).toBe("generic");
    expect(v.body).toBe("recovery.genericBody");
    expect(v.body).not.toContain("jsonrpc");
  });
});
