import { describe, expect, it, vi } from "vitest";
import { createAccountController } from "./account-controller";

describe("createAccountController", () => {
  it("dedupes concurrent sign-in into one flow", async () => {
    let signInCalls = 0;
    const ctrl = createAccountController({
      signIn: async () => {
        signInCalls += 1;
        return { ok: true };
      },
      signOut: async () => ({ ok: true, signedOut: true }),
      status: async () => ({
        signedIn: true,
        accountLabel: "a@x.ai",
        needsReauth: false,
      }),
      sleep: async () => {},
    });
    const a = ctrl.startSignIn();
    const b = ctrl.startSignIn();
    const [ra, rb] = await Promise.all([a, b]);
    expect(signInCalls).toBe(1);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(ctrl.getSnapshot().phase).toBe("signed_in");
  });

  it("reused CLI session skips the browser poll", async () => {
    const ctrl = createAccountController({
      signIn: async () => ({ ok: true, reusedSession: true }),
      signOut: async () => ({ ok: true, signedOut: true }),
      status: async () => ({
        signedIn: true,
        accountLabel: "reuse@x.ai",
        needsReauth: false,
        engineStatus: "ready",
      }),
      sleep: async () => {
        throw new Error("should not poll");
      },
    });
    const r = await ctrl.startSignIn();
    expect(r.ok).toBe(true);
    expect(r.accountLabel).toBe("reuse@x.ai");
    expect(ctrl.getSnapshot().phase).toBe("signed_in");
  });

  it("cancelSignIn stops polling without marking reauth for fresh users", async () => {
    const ctrl = createAccountController({
      signIn: async () => ({ ok: true }),
      signOut: async () => ({ ok: true, signedOut: true }),
      status: async () => ({
        signedIn: false,
        accountLabel: null,
        needsReauth: false,
      }),
      sleep: async () => {
        ctrl.cancelSignIn();
      },
    });
    ctrl.dispatch({
      type: "status_resolved",
      signedIn: false,
      needsReauth: false,
      accountLabel: null,
    });
    const r = await ctrl.startSignIn();
    expect(r.cancelled).toBe(true);
    expect(ctrl.getSnapshot().phase).toBe("signed_out");
  });

  it("sign-out clears usage snapshot and identity", async () => {
    const ctrl = createAccountController({
      signIn: async () => ({ ok: true }),
      signOut: async () => ({ ok: true, signedOut: true }),
      status: async () => ({
        signedIn: false,
        accountLabel: null,
        needsReauth: false,
      }),
      getUsage: async () =>
        ({
          fetchedAt: new Date().toISOString(),
          creditUsagePercent: 42,
          includedUsed: 1,
          totalUsed: 1,
          monthlyLimit: 100,
          onDemandEnabled: false,
          onDemandUsed: null,
          onDemandCap: null,
          prepaidBalance: null,
          subscriptionTier: null,
          billingPeriodStart: null,
          billingPeriodEnd: "2026-08-02",
          warnLevel: "none",
          rawAvailable: true,
        }) as never,
    });
    await ctrl.refreshUsage(true);
    expect(ctrl.getUsageSnapshot()?.creditUsagePercent).toBe(42);
    ctrl.dispatch({
      type: "status_resolved",
      signedIn: true,
      needsReauth: false,
      accountLabel: "a@x.ai",
      accountName: "A",
      models: ["grok-4.5"],
    });
    const out = await ctrl.startSignOut({ activeTaskCount: 0 });
    expect(out.ok).toBe(true);
    expect(ctrl.getUsageSnapshot()).toBeNull();
    expect(ctrl.getSnapshot().identity.accountLabel).toBeNull();
    expect(ctrl.getSnapshot().authenticatedModels).toEqual([]);
  });

  it("requires confirm when tasks are active", async () => {
    const pause = vi.fn();
    const ctrl = createAccountController({
      signIn: async () => ({ ok: true }),
      signOut: async () => ({ ok: true, signedOut: true }),
      status: async () => ({
        signedIn: true,
        accountLabel: "a@x.ai",
      }),
      pauseAllTasks: pause,
    });
    const blocked = await ctrl.startSignOut({ activeTaskCount: 2 });
    expect(blocked.needsConfirm).toBe(true);
    expect(pause).not.toHaveBeenCalled();
    const ok = await ctrl.startSignOut({
      activeTaskCount: 2,
      confirmed: true,
    });
    expect(ok.ok).toBe(true);
    expect(pause).toHaveBeenCalled();
  });
});
