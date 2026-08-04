import { describe, it, expect } from "vitest";
import {
  resolveModelAfterAuth,
  shouldStopSignInPoll,
  SIGN_IN_POLL_ATTEMPTS,
} from "./auth-sign-in-poll";

describe("auth-sign-in-poll", () => {
  it("stops when signed in", () => {
    expect(shouldStopSignInPoll({ signedIn: true })).toBe(true);
    expect(shouldStopSignInPoll({ signedIn: false })).toBe(false);
  });

  it("resolves model against returned list", () => {
    expect(resolveModelAfterAuth("grok-4.5", ["a", "grok-4.5"])).toBe(
      "grok-4.5",
    );
    expect(resolveModelAfterAuth("old", ["a", "b"])).toBe("a");
    expect(resolveModelAfterAuth("x", [])).toBe("x");
    expect(resolveModelAfterAuth("x", null)).toBe("x");
  });

  it("documents poll budget constant", () => {
    expect(SIGN_IN_POLL_ATTEMPTS).toBe(90);
  });
});
