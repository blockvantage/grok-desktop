import { describe, it, expect } from "vitest";
import {
  signOutResultToast,
  signedOutAuthState,
  signInStartToast,
} from "./sign-in-toast";

describe("signedOutAuthState", () => {
  it("is immediately usable for optimistic UI", () => {
    const s = signedOutAuthState();
    expect(s.signedIn).toBe(false);
    expect(s.accountLabel).toBeNull();
    expect(s.engineStatus).toBe("signed_out");
    expect(s.needsReauth).toBe(false);
  });
});

describe("signOutResultToast", () => {
  it("success when signedOut", () => {
    expect(
      signOutResultToast(
        { ok: true, signedOut: true },
        { signedOut: "Signed out", failed: "Failed" },
      ),
    ).toEqual({ description: "Signed out", variant: "success" });
  });

  it("prefers server message on partial failure", () => {
    expect(
      signOutResultToast(
        { ok: false, signedOut: false, message: "still there" },
        { signedOut: "Signed out", failed: "Failed" },
      ),
    ).toEqual({ description: "still there", variant: "destructive" });
  });

  it("fallback failed label", () => {
    expect(
      signOutResultToast(null, {
        signedOut: "Signed out",
        failed: "Failed",
      }),
    ).toEqual({ description: "Failed", variant: "destructive" });
  });
});

describe("signInStartToast", () => {
  it("ok uses complete-login copy", () => {
    expect(
      signInStartToast({ ok: true, message: "x" }, "Complete login"),
    ).toEqual({ description: "Complete login", variant: "default" });
  });
});
