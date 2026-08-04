import { describe, it, expect } from "vitest";
import {
  isAccountSignedIn,
  readinessSignInFlags,
  shouldBlockOnSignIn,
} from "./account-signed-in";
import { projectDesktopReadiness, readinessInputFromAppState } from "./readiness-ui";

describe("isAccountSignedIn", () => {
  it("trusts account phase signed_in over stale auth flag", () => {
    expect(
      isAccountSignedIn({ accountPhase: "signed_in", authSignedIn: false }),
    ).toBe(true);
  });

  it("treats signed_out / reauth as not signed in even if auth is sticky", () => {
    expect(
      isAccountSignedIn({ accountPhase: "signed_out", authSignedIn: true }),
    ).toBe(false);
    expect(
      isAccountSignedIn({
        accountPhase: "reauth_required",
        authSignedIn: true,
      }),
    ).toBe(false);
  });

  it("falls back to auth while checking", () => {
    expect(
      isAccountSignedIn({ accountPhase: "checking", authSignedIn: true }),
    ).toBe(true);
    expect(
      isAccountSignedIn({ accountPhase: "checking", authSignedIn: false }),
    ).toBe(false);
  });
});

describe("shouldBlockOnSignIn", () => {
  it("never blocks while checking or mid sign-in", () => {
    expect(
      shouldBlockOnSignIn({ accountPhase: "checking", signedIn: false }),
    ).toBe(false);
    expect(
      shouldBlockOnSignIn({ accountPhase: "signing_in", signedIn: false }),
    ).toBe(false);
  });

  it("blocks when signed out or reauth required", () => {
    expect(
      shouldBlockOnSignIn({ accountPhase: "signed_out", signedIn: false }),
    ).toBe(true);
    expect(
      shouldBlockOnSignIn({
        accountPhase: "reauth_required",
        signedIn: false,
      }),
    ).toBe(true);
  });

  it("does not block when signed in", () => {
    expect(
      shouldBlockOnSignIn({ accountPhase: "signed_in", signedIn: true }),
    ).toBe(false);
  });
});

describe("readiness + signed-in healthy combinations", () => {
  it("signed-in + engine/runtime ready does not emit Sign-in as a blocker", () => {
    const flags = readinessSignInFlags({
      accountPhase: "signed_in",
      authSignedIn: true,
    });
    const r = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: true,
        signedIn: flags.signedIn,
        signInRequired: flags.signInRequired,
        neverSignedIn: flags.neverSignedIn,
        workspaceSelected: true,
      }),
    );
    expect(r.blocked).toBe(false);
    expect(r.blockedItems.map((i) => i.id)).not.toContain("sign_in");
    const signIn = r.items.find((i) => i.id === "sign_in")!;
    expect(signIn.status).toBe("ok");
    expect(signIn.ctaAction).toBeNull();
  });

  it("account phase signed_in wins over auth.signedIn false (stale auth)", () => {
    const flags = readinessSignInFlags({
      accountPhase: "signed_in",
      authSignedIn: false,
    });
    const r = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: true,
        signedIn: flags.signedIn,
        signInRequired: flags.signInRequired,
        neverSignedIn: flags.neverSignedIn,
        workspaceSelected: true,
      }),
    );
    expect(r.blockedItems.map((i) => i.id)).not.toContain("sign_in");
  });

  it("does not false-block sign-in while account is still checking", () => {
    const flags = readinessSignInFlags({
      accountPhase: "checking",
      authSignedIn: false,
    });
    const r = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: true,
        signedIn: flags.signedIn,
        signInRequired: flags.signInRequired,
        neverSignedIn: flags.neverSignedIn,
        workspaceSelected: true,
      }),
    );
    expect(r.blockedItems.map((i) => i.id)).not.toContain("sign_in");
  });

  it("blocks sign-in when signed_out and other dimensions ready", () => {
    const flags = readinessSignInFlags({
      accountPhase: "signed_out",
      authSignedIn: false,
    });
    const r = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: true,
        signedIn: flags.signedIn,
        signInRequired: flags.signInRequired,
        neverSignedIn: flags.neverSignedIn,
        workspaceSelected: true,
      }),
    );
    expect(r.blocked).toBe(true);
    expect(r.blockedItems.map((i) => i.id)).toContain("sign_in");
    expect(r.blockedItems.find((i) => i.id === "sign_in")!.ctaAction).toBe(
      "sign-in",
    );
  });
});
