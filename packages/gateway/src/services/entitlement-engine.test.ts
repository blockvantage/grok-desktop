/**
 * EntitlementGuardedEngine — last-inference boundary.
 */
import { describe, expect, it, vi } from "vitest";
import type { EngineAdapter, EngineRunOptions } from "../engine-types.js";
import type { Task } from "@grokdesk/shared";
import {
  EntitlementGuardedEngine,
  wrapEngineWithEntitlementGuard,
  PROVIDER_INFERENCE_ACTION,
} from "./entitlement-engine.js";
import {
  createEntitlementGuard,
  type EntitlementGuard,
} from "./entitlement-guard.js";
import { EntitlementReadOnlyError } from "./entitlement-error.js";
import type { DeviceLeaseClaims } from "@grokdesk/license";

const FIXED_NOW = 1_700_000_000;

function activeClaims(): DeviceLeaseClaims {
  return {
    iss: "https://entitlements.test",
    aud: "grok-desk-device",
    entitlementId: "ent-1",
    activationId: "act-1",
    deviceThumbprint: "tp-1",
    productId: "grok-desk",
    capabilities: ["grok-runtime"],
    seatLimit: 3,
    updatePolicy: "lifetime_stable",
    iat: FIXED_NOW,
    refreshAfter: FIXED_NOW + 86_400,
    exp: FIXED_NOW + 30 * 86_400,
    jti: "jti-1",
  };
}

function makeGuard(opts: {
  claims: DeviceLeaseClaims | null;
  nowSeconds?: number;
}): EntitlementGuard {
  return createEntitlementGuard({
    keyRing: { kty: "OKP", crv: "Ed25519", x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    expectedIssuer: "https://entitlements.test",
    expectedAudience: "grok-desk-device",
    nowSeconds: () => opts.nowSeconds ?? FIXED_NOW,
    clockToleranceSeconds: 0,
    injectVerifiedClaims: opts.claims,
    loadState: () => ({
      schema: 1,
      deviceId: "d1",
      devicePublicKeyThumbprint: "tp-1",
      lease: opts.claims ? "unused" : null,
      authoritativeState: "none",
      updatedAt: new Date().toISOString(),
      requestId: null,
    }),
  });
}

function fakeTask(): Task {
  return {
    id: "task-1",
    goal: "hi",
    title: null,
    mode: "interactive",
    status: "running",
    model: "grok-4.5",
    effort: "normal",
    policySnapshot: {
      approvalMode: "autopilot",
      workspaceRoots: ["/tmp"],
      allowNetworkTools: false,
      allowShell: false,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}

function makeInner(runImpl?: EngineAdapter["run"]): EngineAdapter {
  return {
    executesOwnTools: true,
    run: runImpl ?? (async () => {}),
    cancel: async () => {},
  };
}

describe("EntitlementGuardedEngine", () => {
  it("calls assertCapability(provider_inference) then delegates run when allowed", async () => {
    const guard = makeGuard({ claims: activeClaims() });
    await guard.refresh();
    const run = vi.fn(async (_opts: EngineRunOptions) => {});
    const inner = makeInner(run);
    const engine = new EntitlementGuardedEngine(inner, { guard });

    expect(engine.executesOwnTools).toBe(true);
    await engine.run({ task: fakeTask(), onEvent: async () => {} });
    expect(run).toHaveBeenCalledOnce();
  });

  it("blocks run with entitlement_read_only when lease is expired", async () => {
    const expired = activeClaims();
    expired.exp = FIXED_NOW - 10;
    expired.refreshAfter = FIXED_NOW - 100;
    const guard = makeGuard({ claims: expired });
    const run = vi.fn(async () => {});
    const engine = new EntitlementGuardedEngine(makeInner(run), { guard });

    await expect(
      engine.run({ task: fakeTask(), onEvent: async () => {} }),
    ).rejects.toBeInstanceOf(EntitlementReadOnlyError);

    await expect(
      engine.run({ task: fakeTask(), onEvent: async () => {} }),
    ).rejects.toMatchObject({
      code: "entitlement_read_only",
      action: PROVIDER_INFERENCE_ACTION,
      capability: "grok_operation",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("does not gate cancel", async () => {
    const expired = activeClaims();
    expired.exp = FIXED_NOW - 10;
    const guard = makeGuard({ claims: expired });
    const cancel = vi.fn(async () => {});
    const engine = new EntitlementGuardedEngine(
      { executesOwnTools: false, run: async () => {}, cancel },
      { guard },
    );
    await engine.cancel("task-1");
    expect(cancel).toHaveBeenCalledWith("task-1");
  });

  it("wrapEngineWithEntitlementGuard returns inner when guard is null", () => {
    const inner = makeInner();
    expect(wrapEngineWithEntitlementGuard(inner, null)).toBe(inner);
    expect(wrapEngineWithEntitlementGuard(inner, undefined)).toBe(inner);
  });

  it("wrapEngineWithEntitlementGuard returns guarded engine when guard set", async () => {
    const guard = makeGuard({ claims: activeClaims() });
    const inner = makeInner();
    const wrapped = wrapEngineWithEntitlementGuard(inner, guard);
    expect(wrapped).toBeInstanceOf(EntitlementGuardedEngine);
    await wrapped.run({ task: fakeTask(), onEvent: async () => {} });
  });
});
