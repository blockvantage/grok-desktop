import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EntitlementClient } from "@grokdesk/entitlement-client";
import {
  LEASE_REFRESH_PREFIX,
  buildProofSigningMaterial,
  verifyDeviceLease,
  verifyLeaseRefreshProof,
  type DeviceLeaseClaims,
} from "@grokdesk/license";
import {
  reconstructDeviceIdentity,
  type DeviceIdentity,
} from "./device-identity.js";
import {
  createMemoryCredentialVault,
} from "./os-credential-vault.js";
import {
  computeRefreshDelayMs,
  createRefreshLoop,
  REFRESH_JITTER_FRACTION,
  REFRESH_PERIOD_MS,
  signLeaseRefreshProof,
} from "./refresh-loop.js";
import {
  defaultEntitlementStatePath,
  EntitlementStateStore,
  type EntitlementStateFile,
} from "./state-store.js";
import type { DeviceIdentityRecord } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(
  __dirname,
  "../../../../../packages/license/testdata/crypto/v1",
);

const leaseDoc = JSON.parse(
  readFileSync(path.join(vectorsDir, "device-leases.json"), "utf8"),
) as {
  fixedClockSeconds: number;
  claims: {
    iss: string;
    aud: string;
    deviceThumbprint: string;
    entitlementId: string;
    activationId: string;
    jti?: string;
    refreshAfter: number;
    exp: number;
    iat: number;
  };
  keys: {
    lease: {
      kid: string;
      publicJwk: { kty: string; crv: string; x: string };
      privatePkcs8Base64: string;
    };
    device: {
      publicJwk: { kty: string; crv: string; x: string };
      privatePkcs8Base64: string;
    };
  };
  expectedLease: string;
};

const FIXED_NOW = new Date(leaseDoc.fixedClockSeconds * 1000);


function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function vectorIdentity(): DeviceIdentity {
  const record: DeviceIdentityRecord = {
    schema: 1,
    deviceId: "33333333-3333-4333-8333-333333333333",
    publicJwk: {
      kty: "OKP",
      crv: "Ed25519",
      x: leaseDoc.keys.device.publicJwk.x,
    },
    privatePkcs8Base64: leaseDoc.keys.device.privatePkcs8Base64,
    createdAt: FIXED_NOW.toISOString(),
    displayName: "Test MacBook",
  };
  return reconstructDeviceIdentity(record);
}

async function mintLease(overrides: {
  deviceThumbprint?: string;
  refreshAfter?: number;
  exp?: number;
  jti?: string;
  iat?: number;
} = {}): Promise<string> {
  const jose = await import("jose");
  const pem =
    "-----BEGIN PRIVATE KEY-----\n" +
    Buffer.from(leaseDoc.keys.lease.privatePkcs8Base64, "base64")
      .toString("base64")
      .match(/.{1,64}/g)!
      .join("\n") +
    "\n-----END PRIVATE KEY-----";
  const key = await jose.importPKCS8(pem, "EdDSA");
  const now = overrides.iat ?? leaseDoc.fixedClockSeconds;
  return new jose.SignJWT({
    entitlementId: leaseDoc.claims.entitlementId,
    activationId: leaseDoc.claims.activationId,
    deviceThumbprint:
      overrides.deviceThumbprint ?? leaseDoc.claims.deviceThumbprint,
    productId: "grok-desk",
    capabilities: ["grok-runtime"],
    seatLimit: 3,
    updatePolicy: "lifetime_stable",
    refreshAfter: overrides.refreshAfter ?? now + 86_400,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "grokdesk-lease+jwt",
      kid: leaseDoc.keys.lease.kid,
    })
    .setIssuer(leaseDoc.claims.iss)
    .setAudience(leaseDoc.claims.aud)
    .setIssuedAt(now)
    .setExpirationTime(overrides.exp ?? now + 30 * 86_400)
    .setJti(overrides.jti ?? "lease-jti-refresh-001")
    .sign(key);
}

describe("refresh delay jitter", () => {
  it("applies ±10% of 24h around refreshAfter and never goes negative when overdue", () => {
    const refreshAfter = 1_000_000;
    const onTime = refreshAfter * 1000;
    const delayZeroJitter = computeRefreshDelayMs(
      refreshAfter,
      onTime,
      () => 0,
    );
    expect(delayZeroJitter).toBe(0);

    const maxJitter = REFRESH_JITTER_FRACTION * REFRESH_PERIOD_MS;
    const delayPlus = computeRefreshDelayMs(refreshAfter, onTime, () => 1);
    const delayMinus = computeRefreshDelayMs(refreshAfter, onTime, () => -1);
    expect(delayPlus).toBe(maxJitter);
    expect(delayMinus).toBe(0); // clamped

    const early = onTime - 60_000;
    const delayEarly = computeRefreshDelayMs(refreshAfter, early, () => 0);
    expect(delayEarly).toBe(60_000);

    // Overdue
    expect(
      computeRefreshDelayMs(refreshAfter, onTime + 10_000, () => 0),
    ).toBe(0);
  });
});

describe("refresh loop", () => {
  let root: string;
  let store: EntitlementStateStore;
  let identity: DeviceIdentity;
  let fetchImpl: ReturnType<typeof vi.fn>;
  let client: EntitlementClient;
  let claims: DeviceLeaseClaims;
  let initialLease: string;
  let nowMs: number;
  let timers: Array<{ fn: () => void; ms: number; id: number }>;
  let nextTimerId: number;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "gd-ref-"));
    store = new EntitlementStateStore(defaultEntitlementStatePath(root));
    identity = vectorIdentity();
    initialLease = leaseDoc.expectedLease;
    nowMs = leaseDoc.fixedClockSeconds * 1000;

    const verified = await verifyDeviceLease(initialLease, {
      publicKey: {
        kty: "OKP",
        crv: "Ed25519",
        x: leaseDoc.keys.lease.publicJwk.x,
      },
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      expectedDeviceThumbprint: leaseDoc.claims.deviceThumbprint,
      nowSeconds: leaseDoc.fixedClockSeconds,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("fixture lease invalid");
    claims = verified.claims;

    const state: EntitlementStateFile = {
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: leaseDoc.claims.deviceThumbprint,
      lease: initialLease,
      authoritativeState: "none",
      updatedAt: FIXED_NOW.toISOString(),
      requestId: "seed",
    };
    await store.write(state);

    fetchImpl = vi.fn();
    client = new EntitlementClient({
      baseUrl: new URL("https://entitlements.example.invalid/"),
      fetch: fetchImpl as unknown as typeof fetch,
      userAgent: "GrokDesk-Test/1.0.0",
    });

    timers = [];
    nextTimerId = 1;
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  function makeLoop(opts: { randomUnit?: () => number } = {}) {
    return createRefreshLoop({
      client,
      stateStore: store,
      getIdentity: async () => identity,
      leaseVerify: {
        expectedIssuer: leaseDoc.claims.iss,
        expectedAudience: leaseDoc.claims.aud,
        resolveLeasePublicKey: (kid) =>
          kid === leaseDoc.keys.lease.kid
            ? {
                kty: "OKP",
                crv: "Ed25519",
                x: leaseDoc.keys.lease.publicJwk.x,
              }
            : null,
      },
      loadVerifiedClaims: async () => {
        const s = await store.read();
        if (!s?.lease) return null;
        const r = await verifyDeviceLease(s.lease, {
          publicKey: {
            kty: "OKP",
            crv: "Ed25519",
            x: leaseDoc.keys.lease.publicJwk.x,
          },
          expectedIssuer: leaseDoc.claims.iss,
          expectedAudience: leaseDoc.claims.aud,
          expectedDeviceThumbprint: leaseDoc.claims.deviceThumbprint,
          nowSeconds: Math.floor(nowMs / 1000),
        });
        return r.ok ? r.claims : null;
      },
      now: () => new Date(nowMs),
      setTimer: (fn, ms) => {
        const id = nextTimerId++;
        timers.push({ fn, ms, id });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (handle) => {
        const id = handle as unknown as number;
        const idx = timers.findIndex((t) => t.id === id);
        if (idx >= 0) timers.splice(idx, 1);
      },
      randomUnit: opts.randomUnit ?? (() => 0),
    });
  }

  it("signs lease-refresh proofs with the device private key", () => {
    const payload = {
      challengeId: "44444444-4444-4444-8444-444444444444",
      nonce: "refresh-nonce-fixed-001",
      deviceId: identity.deviceId,
      activationId: claims.activationId,
      devicePublicJwk: identity.publicJwk,
      priorLeaseJti: claims.jti,
    };
    const sig = signLeaseRefreshProof(identity.privateKey, payload);
    const material = buildProofSigningMaterial(LEASE_REFRESH_PREFIX, payload);
    expect(material.signingString.startsWith("GROKDESK-LEASE-REFRESH-V1\n")).toBe(
      true,
    );
    expect(
      verifyLeaseRefreshProof({
        payload,
        signatureBase64Url: sig,
        registeredDevicePublicJwk: identity.publicJwk,
        nowMs: FIXED_NOW.getTime(),
        challengeExpiresAtMs: FIXED_NOW.getTime() + 60_000,
      }).ok,
    ).toBe(true);
  });

  it("refreshes successfully and never mutates exp of the prior lease in-place", async () => {
    const newLease = await mintLease({
      jti: "lease-jti-refreshed",
      refreshAfter: leaseDoc.fixedClockSeconds + 2 * 86_400,
      exp: leaseDoc.fixedClockSeconds + 30 * 86_400,
    });
    const priorExp = claims.exp;

    fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v1/leases/challenges")) {
        return jsonResponse(200, {
          challengeId: "44444444-4444-4444-8444-444444444444",
          nonce: "refresh-nonce-1",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      if (u.endsWith("/v1/leases/refresh") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          priorLeaseJti: string;
          signature: string;
        };
        expect(body.priorLeaseJti).toBe(claims.jti);
        expect(body.signature.length).toBeGreaterThan(40);
        return jsonResponse(200, {
          lease: newLease,
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      return jsonResponse(404, {
        code: "service_unavailable",
        message: "nope",
        requestId: "x",
      });
    });

    const loop = makeLoop();
    const result = await loop.refreshNow();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.jti).toBe("lease-jti-refreshed");
    // Prior exp must not be extended as a side effect of network code.
    expect(priorExp).toBe(claims.exp);
    const onDisk = await store.read();
    expect(onDisk?.lease).toBe(newLease);
    expect(onDisk?.authoritativeState).toBe("none");
  });

  it("preserves lease on transient network/5xx failure (offline_grace path)", async () => {
    fetchImpl.mockImplementation(async () => {
      throw new TypeError("ECONNRESET");
    });
    const loop = makeLoop();
    const before = await store.read();
    const result = await loop.refreshNow();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.preservedLease).toBe(true);
    expect(result.denialApplied).toBe(false);
    expect(result.error.code).toBe("service_unavailable");
    const after = await store.read();
    expect(after?.lease).toBe(before?.lease);
    expect(after?.authoritativeState).toBe("none");
    // exp is inside the lease token — bytes unchanged ⇒ exp unchanged.
    expect(after?.lease).toBe(initialLease);
  });

  it("applies authoritative denial immediately on suspension", async () => {
    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/v1/leases/challenges")) {
        return jsonResponse(200, {
          challengeId: "c",
          nonce: "n",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      return jsonResponse(403, {
        code: "entitlement_suspended",
        message: "Entitlement is suspended",
        requestId: "req-susp",
      });
    });
    const loop = makeLoop();
    const result = await loop.refreshNow();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denialApplied).toBe(true);
    expect(result.error.code).toBe("entitlement_suspended");
    const after = await store.read();
    expect(after?.authoritativeState).toBe("suspended");
    // Lease bytes may remain until natural expiry.
    expect(after?.lease).toBe(initialLease);
  });

  it("refreshes at startup when now >= refreshAfter", async () => {
    // Seed a lease that is past refreshAfter but not expired.
    const dueLease = await mintLease({
      jti: "lease-due",
      refreshAfter: leaseDoc.fixedClockSeconds - 10,
      exp: leaseDoc.fixedClockSeconds + 10 * 86_400,
    });
    await store.write({
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: leaseDoc.claims.deviceThumbprint,
      lease: dueLease,
      authoritativeState: "none",
      updatedAt: FIXED_NOW.toISOString(),
      requestId: "due",
    });

    const refreshed = await mintLease({
      jti: "lease-after-startup",
      refreshAfter: leaseDoc.fixedClockSeconds + 86_400,
      exp: leaseDoc.fixedClockSeconds + 30 * 86_400,
    });

    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/v1/leases/challenges")) {
        return jsonResponse(200, {
          challengeId: "c",
          nonce: "n",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      if (String(url).endsWith("/v1/leases/refresh")) {
        return jsonResponse(200, {
          lease: refreshed,
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      return jsonResponse(500, {
        code: "service_unavailable",
        message: "x",
        requestId: "e",
      });
    });

    const loop = makeLoop();
    const initResult = await loop.initialize();
    expect(initResult?.ok).toBe(true);
    const onDisk = await store.read();
    expect(onDisk?.lease).toBe(refreshed);
    // And scheduled next fire.
    expect(loop.nextFireAtMs()).not.toBeNull();
  });

  it("schedules with jitter when refresh not yet due", async () => {
    const loop = makeLoop({ randomUnit: () => 0.5 });
    const initResult = await loop.initialize();
    expect(initResult).toBeNull();
    const fireAt = loop.nextFireAtMs();
    expect(fireAt).not.toBeNull();
    // claims.refreshAfter is fixedClock + 24h for expectedLease
    const expectedBase = claims.refreshAfter * 1000;
    const expectedJitter = 0.5 * REFRESH_JITTER_FRACTION * REFRESH_PERIOD_MS;
    expect(fireAt).toBe(expectedBase + expectedJitter);
    loop.stop();
    expect(loop.nextFireAtMs()).toBeNull();
  });

  it("single-flights concurrent refreshNow calls", async () => {
    let refreshCalls = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const newLease = await mintLease({ jti: "sf-1" });

    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/v1/leases/challenges")) {
        return jsonResponse(200, {
          challengeId: "c",
          nonce: "n",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      if (String(url).endsWith("/v1/leases/refresh")) {
        refreshCalls += 1;
        await gate;
        return jsonResponse(200, {
          lease: newLease,
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      return jsonResponse(500, {
        code: "service_unavailable",
        message: "x",
        requestId: "e",
      });
    });

    const loop = makeLoop();
    const p1 = loop.refreshNow();
    const p2 = loop.refreshNow();
    expect(loop.isInFlight()).toBe(true);
    release!();
    const [a, b] = await Promise.all([p1, p2]);
    expect(a.ok && b.ok).toBe(true);
    expect(refreshCalls).toBe(1);
  });
});
