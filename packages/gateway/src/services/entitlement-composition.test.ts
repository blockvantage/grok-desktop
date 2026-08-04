/**
 * Entitlement composition — env → guard wiring (production root).
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PublicJwk } from "@grokdesk/license";
import type { EngineAdapter } from "../engine-types.js";
import {
  createEntitlementGuardFromEnv,
  parseLeasePublicJwks,
  wireEntitlementEnforcement,
  ENTITLEMENT_STATE_PATH_ENV,
  LEASE_PUBLIC_JWKS_ENV,
  ENTITLEMENT_ISSUER_ENV,
  ENTITLEMENT_AUDIENCE_ENV,
} from "./entitlement-composition.js";
import { EntitlementGuardedEngine } from "./entitlement-engine.js";
import type { EntitlementStateEnvelope } from "./entitlement-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(
  __dirname,
  "../../../license/testdata/crypto/v1",
);

const leaseDoc = JSON.parse(
  readFileSync(path.join(vectorsDir, "device-leases.json"), "utf8"),
) as {
  fixedClockSeconds: number;
  claims: {
    iss: string;
    aud: string;
    deviceThumbprint: string;
  };
  keys: {
    lease: {
      kid: string;
      publicJwk: PublicJwk;
    };
  };
  expectedLease: string;
};

const PUBLIC_JWK = leaseDoc.keys.lease.publicJwk;
const FIXED_NOW = leaseDoc.fixedClockSeconds;

function baseState(
  overrides: Partial<EntitlementStateEnvelope> = {},
): EntitlementStateEnvelope {
  return {
    schema: 1,
    deviceId: "device-uuid-test-1",
    devicePublicKeyThumbprint: leaseDoc.claims.deviceThumbprint,
    lease: leaseDoc.expectedLease,
    authoritativeState: "none",
    updatedAt: new Date(FIXED_NOW * 1000).toISOString(),
    requestId: null,
    ...overrides,
  };
}

describe("parseLeasePublicJwks", () => {
  it("accepts a JSON array of OKP Ed25519 JWKs with kid", () => {
    const map = parseLeasePublicJwks(JSON.stringify([PUBLIC_JWK]));
    expect(map).not.toBeNull();
    expect(map!.get(leaseDoc.keys.lease.kid)?.x).toBe(PUBLIC_JWK.x);
  });

  it("accepts JWKS { keys: [...] } shape", () => {
    const map = parseLeasePublicJwks(
      JSON.stringify({ keys: [PUBLIC_JWK] }),
    );
    expect(map?.has(leaseDoc.keys.lease.kid)).toBe(true);
  });

  it("rejects empty / invalid / missing kid", () => {
    expect(parseLeasePublicJwks("")).toBeNull();
    expect(parseLeasePublicJwks("not-json")).toBeNull();
    expect(parseLeasePublicJwks("[]")).toBeNull();
    expect(
      parseLeasePublicJwks(
        JSON.stringify([{ kty: "OKP", crv: "Ed25519", x: "abc" }]),
      ),
    ).toBeNull();
  });
});

describe("createEntitlementGuardFromEnv", () => {
  let tmp: string | null = null;

  afterEach(async () => {
    if (tmp) {
      await fsp.rm(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it("always returns null (free Desk ignores product lease env)", () => {
    expect(createEntitlementGuardFromEnv({})).toBeNull();
    expect(
      createEntitlementGuardFromEnv({
        [ENTITLEMENT_STATE_PATH_ENV]: "/abs/state.json",
        [LEASE_PUBLIC_JWKS_ENV]: JSON.stringify([PUBLIC_JWK]),
        GROKDESK_ENTITLEMENT_FAIL_CLOSED: "1",
        GROKDESK_PACKAGED: "1",
      }),
    ).toBeNull();
  });

  it("ignores complete product lease state files", async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ent-comp-"));
    const statePath = path.join(tmp, "entitlement-state.json");
    await fsp.writeFile(statePath, JSON.stringify(baseState()), "utf8");

    const guard = createEntitlementGuardFromEnv({
      [ENTITLEMENT_STATE_PATH_ENV]: statePath,
      [LEASE_PUBLIC_JWKS_ENV]: JSON.stringify([PUBLIC_JWK]),
      [ENTITLEMENT_ISSUER_ENV]: leaseDoc.claims.iss,
      [ENTITLEMENT_AUDIENCE_ENV]: leaseDoc.claims.aud,
    });

    expect(guard).toBeNull();
  });
});

describe("wireEntitlementEnforcement", () => {
  it("fails closed for every Grok action when runtime readiness is paused", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "runtime-ready-"));
    try {
      const readinessPath = path.join(tmp, "runtime-readiness.json");
      await fsp.writeFile(
        readinessPath,
        JSON.stringify({
          schemaVersion: 1,
          managedRuntimeReady: true,
          updatesReady: true,
          admissionPaused: true,
          securityBlocked: false,
          reason: "admission_paused",
          updatedAt: new Date().toISOString(),
        }),
      );
      let engine: EngineAdapter = {
        executesOwnTools: false,
        run: async () => {},
        cancel: async () => {},
      };
      const guardable = { setEntitlementGuard() {} };
      const guard = await wireEntitlementEnforcement({
        taskSubmission: guardable,
        scheduler: guardable,
        runner: guardable,
        getEngine: () => engine,
        setEngine: (next) => {
          engine = next;
        },
        env: {
          GROKDESK_ENTITLEMENT_FAIL_CLOSED: "0",
          GROKDESK_RUNTIME_READINESS_FAIL_CLOSED: "1",
          GROKDESK_RUNTIME_READINESS_STATE_PATH: readinessPath,
        },
      });
      expect(guard).not.toBeNull();
      for (const action of [
        "interactive",
        "follow_up",
        "revision",
        "retry",
        "remote",
        "scheduled",
        "queued_execution",
        "provider_inference",
        "title_generation",
        "dictation",
      ]) {
        expect(() =>
          guard!.assertCapabilitySync("grok_operation", action),
        ).toThrow(/read-only/i);
        await expect(
          guard!.assertCapability("grok_operation", action),
        ).rejects.toMatchObject({
          code: "entitlement_read_only",
          denialCode: "admission_paused",
        });
      }
      await expect(
        guard!.assertCapability("local_read", "export_chat"),
      ).resolves.toBeUndefined();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it("allows Grok only when managed runtime and updates are both ready", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "runtime-ready-"));
    try {
      const readinessPath = path.join(tmp, "runtime-readiness.json");
      await fsp.writeFile(
        readinessPath,
        JSON.stringify({
          schemaVersion: 1,
          managedRuntimeReady: true,
          updatesReady: true,
          admissionPaused: false,
          securityBlocked: false,
          reason: "ready",
          updatedAt: new Date().toISOString(),
        }),
      );
      let engine: EngineAdapter = {
        executesOwnTools: false,
        run: async () => {},
        cancel: async () => {},
      };
      const guardable = { setEntitlementGuard() {} };
      const guard = await wireEntitlementEnforcement({
        taskSubmission: guardable,
        scheduler: guardable,
        runner: guardable,
        getEngine: () => engine,
        setEngine: (next) => {
          engine = next;
        },
        env: {
          GROKDESK_ENTITLEMENT_FAIL_CLOSED: "0",
          GROKDESK_RUNTIME_READINESS_FAIL_CLOSED: "1",
          GROKDESK_RUNTIME_READINESS_STATE_PATH: readinessPath,
        },
      });
      expect(guard).not.toBeNull();
      expect(() =>
        guard!.assertCapabilitySync("grok_operation", "interactive"),
      ).not.toThrow();
      await expect(
        guard!.assertCapability("grok_operation", "provider_inference"),
      ).resolves.toBeUndefined();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it("denies Grok when the fail-closed readiness file is absent", async () => {
    let engine: EngineAdapter = {
      executesOwnTools: false,
      run: async () => {},
      cancel: async () => {},
    };
    const guardable = { setEntitlementGuard() {} };
    const guard = await wireEntitlementEnforcement({
      taskSubmission: guardable,
      scheduler: guardable,
      runner: guardable,
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      env: {
        GROKDESK_ENTITLEMENT_FAIL_CLOSED: "0",
        GROKDESK_RUNTIME_READINESS_FAIL_CLOSED: "1",
      },
    });
    expect(guard).not.toBeNull();
    await expect(
      guard!.assertCapability("grok_operation", "interactive"),
    ).rejects.toMatchObject({
      denialCode: "readiness_state_invalid",
    });
  });

  it("no-ops when env incomplete and fail-closed is off (unit tests)", async () => {
    const setCalls: Array<unknown> = [];
    let engine: EngineAdapter = {
      executesOwnTools: false,
      run: async () => {},
      cancel: async () => {},
    };
    const guardable = {
      setEntitlementGuard(g: unknown) {
        setCalls.push(g);
      },
    };

    const result = await wireEntitlementEnforcement({
      taskSubmission: guardable,
      scheduler: guardable,
      runner: guardable,
      getEngine: () => engine,
      setEngine: (e) => {
        engine = e;
      },
      env: {
        // Explicit opt-out so focused unit tests without entitlement fixtures stay green.
        GROKDESK_ENTITLEMENT_FAIL_CLOSED: "0",
      },
    });

    expect(result).toBeNull();
    expect(setCalls.every((g) => g === null)).toBe(true);
    expect(engine).not.toBeInstanceOf(EntitlementGuardedEngine);
  });

  it("free Desk: product-license fail-closed env never installs deny-all guard", async () => {
    const guards: unknown[] = [];
    let engine: EngineAdapter = {
      executesOwnTools: false,
      run: async () => {},
      cancel: async () => {},
    };
    const guardable = {
      setEntitlementGuard(g: unknown) {
        guards.push(g);
      },
    };

    const result = await wireEntitlementEnforcement({
      taskSubmission: guardable,
      scheduler: guardable,
      runner: guardable,
      getEngine: () => engine,
      setEngine: (e) => {
        engine = e;
      },
      env: {
        GROKDESK_ENTITLEMENT_FAIL_CLOSED: "1",
        GROKDESK_PACKAGED: "1",
        // Product-license fail-closed retired; disable runtime readiness fail-closed
        // so this case asserts product-lease ignore only.
        GROKDESK_RUNTIME_READINESS_FAIL_CLOSED: "0",
      },
    });

    // No product-license deny-all; no runtime readiness path → null guard.
    expect(result).toBeNull();
    expect(guards.every((g) => g === null)).toBe(true);
    expect(engine).not.toBeInstanceOf(EntitlementGuardedEngine);
  });

  it("free Desk: ignores complete product-lease env (no product guard)", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ent-wire-"));
    try {
      const statePath = path.join(tmp, "entitlement-state.json");
      await fsp.writeFile(
        statePath,
        JSON.stringify(baseState({ lease: null })),
        "utf8",
      );

      const guards: unknown[] = [];
      let engine: EngineAdapter = {
        executesOwnTools: false,
        run: async () => {},
        cancel: async () => {},
      };
      const guardable = {
        setEntitlementGuard(g: unknown) {
          guards.push(g);
        },
      };
      const remote = {
        setEntitlementGuard(g: unknown) {
          guards.push(g);
        },
      };

      const result = await wireEntitlementEnforcement({
        taskSubmission: guardable,
        scheduler: guardable,
        runner: guardable,
        remote,
        getEngine: () => engine,
        setEngine: (e) => {
          engine = e;
        },
        env: {
          [ENTITLEMENT_STATE_PATH_ENV]: statePath,
          [LEASE_PUBLIC_JWKS_ENV]: JSON.stringify([PUBLIC_JWK]),
          [ENTITLEMENT_ISSUER_ENV]: leaseDoc.claims.iss,
          [ENTITLEMENT_AUDIENCE_ENV]: leaseDoc.claims.aud,
          // No runtime readiness path → free admission
          GROKDESK_RUNTIME_READINESS_FAIL_CLOSED: "0",
        },
      });

      expect(result).toBeNull();
      expect(guards.every((g) => g === null)).toBe(true);
      expect(engine).not.toBeInstanceOf(EntitlementGuardedEngine);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
