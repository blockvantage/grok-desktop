import { describe, expect, it } from "vitest";
import {
  clearAccountBoundState,
  initialAccountSnapshot,
  phaseFromAuthStatus,
  reduceAccount,
  shouldShowReauthBanner,
  shouldShowSignInInvite,
  signOutActiveTaskPolicy,
} from "./account-state";

describe("phaseFromAuthStatus", () => {
  it("maps signed-in", () => {
    expect(phaseFromAuthStatus({ signedIn: true })).toBe("signed_in");
  });

  it("maps never-signed-in to signed_out, not reauth", () => {
    expect(
      phaseFromAuthStatus({ signedIn: false, needsReauth: false }),
    ).toBe("signed_out");
    expect(shouldShowReauthBanner("signed_out")).toBe(false);
    expect(shouldShowSignInInvite("signed_out")).toBe(true);
  });

  it("maps stale session to reauth_required", () => {
    expect(
      phaseFromAuthStatus({ signedIn: false, needsReauth: true }),
    ).toBe("reauth_required");
    expect(shouldShowReauthBanner("reauth_required")).toBe(true);
    expect(shouldShowSignInInvite("reauth_required")).toBe(false);
  });
});

describe("reduceAccount", () => {
  it("starts checking then resolves signed_out without reauth copy", () => {
    let s = initialAccountSnapshot();
    s = reduceAccount(s, { type: "boot_started" });
    expect(s.phase).toBe("checking");
    s = reduceAccount(s, {
      type: "status_resolved",
      signedIn: false,
      needsReauth: false,
      accountLabel: null,
    });
    expect(s.phase).toBe("signed_out");
    expect(s.needsReauth).toBe(false);
  });

  it("dedupes sign_in_started while already signing in", () => {
    let s = initialAccountSnapshot({ phase: "signed_out" });
    s = reduceAccount(s, { type: "sign_in_started" });
    const mid = reduceAccount(s, { type: "sign_in_step", step: "waiting_for_supergrok" });
    const again = reduceAccount(mid, { type: "sign_in_started" });
    expect(again.phase).toBe("signing_in");
    expect(again.signInStep).toBe("waiting_for_supergrok");
  });

  it("cancel returns to signed_out or reauth_required", () => {
    let s = initialAccountSnapshot({ phase: "signed_out" });
    s = reduceAccount(s, { type: "sign_in_started" });
    s = reduceAccount(s, { type: "sign_in_cancelled" });
    expect(s.phase).toBe("signed_out");

    s = initialAccountSnapshot({ phase: "reauth_required", needsReauth: true });
    s = reduceAccount(s, { type: "sign_in_started" });
    s = reduceAccount(s, { type: "sign_in_cancelled" });
    expect(s.phase).toBe("reauth_required");
  });

  it("background status does not clobber signing_in", () => {
    let s = initialAccountSnapshot({ phase: "signed_out" });
    s = reduceAccount(s, { type: "sign_in_started" });
    s = reduceAccount(s, {
      type: "status_resolved",
      signedIn: false,
      needsReauth: false,
      accountLabel: null,
    });
    expect(s.phase).toBe("signing_in");
  });

  it("sign-out success clears identity, models, reauth atomically", () => {
    let s = initialAccountSnapshot({
      phase: "signed_in",
      identity: { accountLabel: "a@x.ai", accountName: "A" },
      authenticatedModels: ["grok-4.5"],
      needsReauth: false,
    });
    s = reduceAccount(s, { type: "sign_out_started" });
    s = reduceAccount(s, {
      type: "sign_out_finished",
      ok: true,
      signedOut: true,
    });
    expect(s.phase).toBe("signed_out");
    expect(s.identity.accountLabel).toBeNull();
    expect(s.authenticatedModels).toEqual([]);
    expect(s.needsReauth).toBe(false);
  });

  it("clearAccountBoundState wipes authenticated models", () => {
    const cleared = clearAccountBoundState(
      initialAccountSnapshot({
        phase: "signed_in",
        authenticatedModels: ["m1"],
        identity: { accountLabel: "x", accountName: "X" },
      }),
    );
    expect(cleared.authenticatedModels).toEqual([]);
    expect(cleared.identity.accountLabel).toBeNull();
  });

  it("keeps network/gateway/engine as separate fields", () => {
    let s = initialAccountSnapshot();
    s = reduceAccount(s, { type: "network", reachability: "offline" });
    s = reduceAccount(s, { type: "gateway", health: "dead" });
    s = reduceAccount(s, { type: "engine", readiness: "missing" });
    s = reduceAccount(s, {
      type: "status_resolved",
      signedIn: true,
      needsReauth: false,
      accountLabel: "a@x.ai",
      engineStatus: "ready",
    });
    expect(s.phase).toBe("signed_in");
    expect(s.network).toBe("offline");
    expect(s.gateway).toBe("dead");
    expect(s.engine).toBe("ready");
  });
});

describe("signOutActiveTaskPolicy", () => {
  it("requires confirm and stops tasks when work is active", () => {
    const p = signOutActiveTaskPolicy(2);
    expect(p.requiresConfirm).toBe(true);
    expect(p.stopsTasks).toBe(true);
    expect(p.sharedCliSessionAffected).toBe(true);
  });

  it("still flags shared CLI session when idle", () => {
    const p = signOutActiveTaskPolicy(0);
    expect(p.requiresConfirm).toBe(false);
    expect(p.sharedCliSessionAffected).toBe(true);
  });
});
