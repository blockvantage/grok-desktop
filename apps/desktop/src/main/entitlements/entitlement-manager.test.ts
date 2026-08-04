import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EntitlementClient } from "@grokdesk/entitlement-client";
import { verifyDeviceLease } from "@grokdesk/license";
import {
  createEntitlementManager,
  type EntitlementManager,
} from "./entitlement-manager.js";
import {
  reconstructDeviceIdentity,
  type DeviceIdentity,
} from "./device-identity.js";
import {
  createMemoryCredentialVault,
  type OsCredentialVault,
} from "./os-credential-vault.js";
import {
  defaultEntitlementStatePath,
  EntitlementStateStore,
} from "./state-store.js";
import {
  DEVICE_IDENTITY_ACCOUNT,
  PRODUCT_KEY_ACCOUNT,
  type DeviceIdentityRecord,
} from "./types.js";

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
  };
  keys: {
    lease: {
      kid: string;
      publicJwk: { kty: string; crv: string; x: string; kid?: string };
      privatePkcs8Base64: string;
    };
    device: {
      publicJwk: { kty: string; crv: string; x: string };
      privatePkcs8Base64: string;
    };
  };
  expectedLease: string;
};

const productDoc = JSON.parse(
  readFileSync(path.join(vectorsDir, "product-keys.json"), "utf8"),
) as {
  cases: Array<{ name: string; input?: { gd3?: string } }>;
};

const VALID_GD3 = productDoc.cases.find((c) => c.name === "valid")!.input!
  .gd3!;

const FIXED_NOW_MS = leaseDoc.fixedClockSeconds * 1000;


function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
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
    createdAt: new Date(FIXED_NOW_MS).toISOString(),
    displayName: "Test MacBook",
  };
  return reconstructDeviceIdentity(record);
}

async function mintLease(overrides: {
  jti?: string;
  refreshAfter?: number;
  exp?: number;
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
    deviceThumbprint: leaseDoc.claims.deviceThumbprint,
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
    .setJti(overrides.jti ?? "mgr-lease-1")
    .sign(key);
}

describe("entitlement manager", () => {
  const previousLeaseJwks = process.env.GROKDESK_LEASE_PUBLIC_JWKS;
  let root: string;
  let vault: OsCredentialVault;
  let store: EntitlementStateStore;
  let identity: DeviceIdentity;
  let fetchImpl: ReturnType<typeof vi.fn>;
  let client: EntitlementClient;
  let manager: EntitlementManager;
  let nowMs: number;
  let statusEvents: string[];

  beforeEach(async () => {
    process.env.GROKDESK_LEASE_PUBLIC_JWKS = JSON.stringify([
      {
        kty: "OKP",
        crv: "Ed25519",
        x: leaseDoc.keys.lease.publicJwk.x,
        kid: leaseDoc.keys.lease.kid,
        use: "sig",
        alg: "EdDSA",
      },
    ]);
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "gd-mgr-"));
    vault = createMemoryCredentialVault();
    store = new EntitlementStateStore(defaultEntitlementStatePath(root));
    identity = vectorIdentity();
    await vault.set(
      DEVICE_IDENTITY_ACCOUNT,
      JSON.stringify({
        schema: 1,
        deviceId: identity.deviceId,
        publicJwk: identity.publicJwk,
        privatePkcs8Base64: identity.privatePkcs8Base64,
        createdAt: identity.createdAt,
        displayName: identity.displayName,
      }),
    );

    nowMs = FIXED_NOW_MS;
    statusEvents = [];
    fetchImpl = vi.fn();
    client = new EntitlementClient({
      baseUrl: new URL("https://entitlements.example.invalid/"),
      fetch: fetchImpl as unknown as typeof fetch,
      userAgent: "GrokDesk-Test/1.0.0",
    });

    manager = createEntitlementManager({
      vault,
      stateStore: store,
      client,
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0.0",
        deskVersion: "1.0.0",
      },
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      now: () => new Date(nowMs),
      refresh: {
        setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
        clearTimer: () => undefined,
        randomUnit: () => 0,
      },
      onStatusChange: (s) => {
        statusEvents.push(s.state);
      },
    });
  });

  afterEach(async () => {
    manager.stop();
    await fsp.rm(root, { recursive: true, force: true });
    if (previousLeaseJwks === undefined) {
      delete process.env.GROKDESK_LEASE_PUBLIC_JWKS;
    } else {
      process.env.GROKDESK_LEASE_PUBLIC_JWKS = previousLeaseJwks;
    }
  });

  function mockWellKnown() {
    return jsonResponse(200, {
      keys: [
        {
          kty: "OKP",
          crv: "Ed25519",
          x: leaseDoc.keys.lease.publicJwk.x,
          kid: leaseDoc.keys.lease.kid,
          use: "sig",
          alg: "EdDSA",
          purpose: "lease",
        },
      ],
    });
  }

  it("loads the device identity single-flight under concurrent callers", async () => {
    // Empty vault: getIdentity must CREATE the identity. Two callers racing
    // before the first resolves must share ONE create — otherwise both mint
    // and write, racing the vault (last-write-wins churn).
    const mem = new Map<string, string>();
    const setAccounts: string[] = [];
    const spyVault: OsCredentialVault = {
      get: async (a) => mem.get(a) ?? null,
      set: async (a, v) => {
        setAccounts.push(a);
        mem.set(a, v);
      },
      delete: async (a) => {
        const had = mem.has(a);
        mem.delete(a);
        return had;
      },
    };
    const freshDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gd-sf-"));
    const freshManager = createEntitlementManager({
      vault: spyVault,
      stateStore: new EntitlementStateStore(
        defaultEntitlementStatePath(freshDir),
      ),
      client,
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0.0",
        deskVersion: "1.0.0",
      },
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      now: () => new Date(nowMs),
      refresh: {
        setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
        clearTimer: () => undefined,
        randomUnit: () => 0,
      },
    });
    try {
      const [a, b, c] = await Promise.all([
        freshManager.getIdentity(),
        freshManager.getIdentity(),
        freshManager.getIdentity(),
      ]);
      expect(a.deviceId).toBe(b.deviceId);
      expect(b.deviceId).toBe(c.deviceId);
      // Exactly one device-identity write — no create stampede.
      expect(
        setAccounts.filter((x) => x === DEVICE_IDENTITY_ACCOUNT).length,
      ).toBe(1);
    } finally {
      freshManager.stop();
      await fsp.rm(freshDir, { recursive: true, force: true });
    }
  });

  it("dev-unlock reports active without a lease (local `make local` bypass)", async () => {
    // Same seeded vault, NO minted lease: a normal manager reports "unactivated"
    // (see the next test). With devUnlock the status is forced "active" so the
    // renderer skips the activation wall. It short-circuits before any vault
    // claim read or well-known fetch, so no network mock is needed.
    const devManager = createEntitlementManager({
      vault,
      stateStore: store,
      client,
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0.0",
        deskVersion: "1.0.0",
      },
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      now: () => new Date(nowMs),
      refresh: {
        setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
        clearTimer: () => undefined,
        randomUnit: () => 0,
      },
      devUnlock: true,
    });
    try {
      const status = await devManager.getStatus();
      expect(status.state).toBe("active");
      expect(status.recoveryAction).toBe("none");
      expect(status.lastError).toBeNull();
      // Best-effort identity still surfaces from the seeded vault.
      expect(status.deviceId).toBe(identity.deviceId);
      // No network was needed to reach an unlocked status.
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      devManager.stop();
    }
  });

  it("reports unactivated when no lease is present", async () => {
    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).includes("grokdesk-keys")) return mockWellKnown();
      return jsonResponse(503, {
        code: "service_unavailable",
        message: "down",
        requestId: "x",
      });
    });
    const status = await manager.initialize();
    expect(status.state).toBe("unactivated");
    expect(status.deviceName).toBe("Test MacBook");
    expect(status.deviceId).toBe(identity.deviceId);
    expect(status.recoveryAction).toBe("purchase");
  });

  it("never promotes fetched lease keys beyond the baked trust root", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, {
        keys: [
          {
            kty: "OKP",
            crv: "Ed25519",
            x: "attacker-substitution",
            kid: leaseDoc.keys.lease.kid,
            use: "sig",
            alg: "EdDSA",
          },
          {
            kty: "OKP",
            crv: "Ed25519",
            x: "attacker-extension",
            kid: "attacker-only",
            use: "sig",
            alg: "EdDSA",
          },
        ],
      }),
    );

    await manager.initialize();
    await expect(manager.getLeasePublicJwksForGateway()).resolves.toEqual([
      expect.objectContaining({
        kid: leaseDoc.keys.lease.kid,
        x: leaseDoc.keys.lease.publicJwk.x,
      }),
    ]);
  });

  it("activates end-to-end through the manager and schedules refresh", async () => {
    const lease = await mintLease();
    fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("grokdesk-keys")) return mockWellKnown();
      if (u.endsWith("/v1/activations/challenges")) {
        return jsonResponse(200, {
          challengeId: "22222222-2222-4222-8222-222222222222",
          nonce: "n1",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      if (u.endsWith("/v1/activations") && init?.method === "POST") {
        return jsonResponse(200, {
          activationId: leaseDoc.claims.activationId,
          entitlementId: leaseDoc.claims.entitlementId,
          seatSlot: 1,
          lease,
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      return jsonResponse(404, {
        code: "service_unavailable",
        message: "no",
        requestId: "x",
      });
    });

    await manager.initialize();
    const result = await manager.activate(VALID_GD3);
    expect(result.ok).toBe(true);
    const status = await manager.getStatus();
    expect(status.state).toBe("active");
    expect(status.expiresAt).toBeTruthy();
    expect(status.refreshAfter).toBeTruthy();
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);
    expect(statusEvents).toContain("active");
  });

  it("retains key on seat_limit via manager activate", async () => {
    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).includes("grokdesk-keys")) return mockWellKnown();
      if (String(url).endsWith("/v1/activations/challenges")) {
        return jsonResponse(200, {
          challengeId: "c",
          nonce: "n",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      return jsonResponse(409, {
        code: "seat_limit",
        message: "All device seats are in use",
        requestId: "seat",
      });
    });
    await manager.initialize();
    const result = await manager.activate(VALID_GD3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.keyStored).toBe(true);
    expect(result.error.recoveryAction).toBe("portal");
    const status = await manager.getStatus();
    expect(status.state).toBe("seat_limit");
  });

  it("startup refresh when due and offline_grace when refresh fails", async () => {
    const dueLease = await mintLease({
      jti: "due-startup",
      refreshAfter: leaseDoc.fixedClockSeconds - 5,
      exp: leaseDoc.fixedClockSeconds + 20 * 86_400,
    });
    await store.write({
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: leaseDoc.claims.deviceThumbprint,
      lease: dueLease,
      authoritativeState: "none",
      updatedAt: new Date(nowMs).toISOString(),
      requestId: "seed",
    });

    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).includes("grokdesk-keys")) return mockWellKnown();
      // Refresh path fails transiently.
      throw new TypeError("offline");
    });

    const status = await manager.initialize();
    expect(status.state).toBe("offline_grace");
    expect(status.recoveryAction).toBe("none");
    // Lease still present and unexpired — exp not extended or cleared.
    const onDisk = await store.read();
    expect(onDisk?.lease).toBe(dueLease);
    const verified = await verifyDeviceLease(dueLease, {
      publicKey: {
        kty: "OKP",
        crv: "Ed25519",
        x: leaseDoc.keys.lease.publicJwk.x,
      },
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      nowSeconds: leaseDoc.fixedClockSeconds,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.exp).toBe(leaseDoc.fixedClockSeconds + 20 * 86_400);
    }
  });

  it("writes revocation denial immediately on refresh", async () => {
    await store.write({
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: leaseDoc.claims.deviceThumbprint,
      lease: leaseDoc.expectedLease,
      authoritativeState: "none",
      updatedAt: new Date(nowMs).toISOString(),
      requestId: "seed",
    });

    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).includes("grokdesk-keys")) return mockWellKnown();
      if (String(url).endsWith("/v1/leases/challenges")) {
        return jsonResponse(200, {
          challengeId: "c",
          nonce: "n",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      return jsonResponse(403, {
        code: "entitlement_revoked",
        message: "Entitlement has been revoked",
        requestId: "rev",
      });
    });

    await manager.initialize();
    const result = await manager.refresh();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denialApplied).toBe(true);
    const status = await manager.getStatus();
    expect(status.state).toBe("revoked");
    expect(status.recoveryAction).toBe("portal");
    expect((await store.read())?.authoritativeState).toBe("revoked");
  });

  it("does not leak product keys into status or errors", async () => {
    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).includes("grokdesk-keys")) return mockWellKnown();
      if (String(url).endsWith("/v1/activations/challenges")) {
        return jsonResponse(200, {
          challengeId: "c",
          nonce: "secret-nonce-value",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          serverTime: new Date(nowMs).toISOString(),
        });
      }
      return jsonResponse(401, {
        code: "invalid_key_signature",
        message: "Product key signature is invalid",
        requestId: "bad",
      });
    });
    await manager.initialize();
    const result = await manager.activate(VALID_GD3);
    expect(result.ok).toBe(false);
    const status = await manager.getStatus();
    const blob = JSON.stringify({ result, status });
    expect(blob).not.toContain("GD3.");
    expect(blob).not.toContain("secret-nonce-value");
    expect(blob).not.toContain(identity.privatePkcs8Base64);
  });
});
