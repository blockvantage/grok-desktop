import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENTITLEMENT_MAIN_IPC_CHANNELS } from "@grokdesk/shared";
import {
  createEntitlementManager,
  type EntitlementManager,
} from "./entitlement-manager.js";
import {
  assertNoEntitlementSecrets,
  createEntitlementIpcHandlers,
  dtoOmitsInternalFields,
  registerEntitlementIpc,
  toEntitlementStatusDto,
  unregisterEntitlementIpc,
  type IpcMainLike,
} from "./ipc.js";
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
import { EntitlementClient } from "@grokdesk/entitlement-client";

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
};

const productDoc = JSON.parse(
  readFileSync(path.join(vectorsDir, "product-keys.json"), "utf8"),
) as {
  cases: Array<{ name: string; input?: { gd3?: string } }>;
};

const VALID_GD3 = productDoc.cases.find((c) => c.name === "valid")!.input!.gd3!;
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
    .setJti(overrides.jti ?? "jti-ipc-test-1")
    .sign(key);
}

describe("toEntitlementStatusDto", () => {
  it("omits deviceId, activationId, lease, and lastError object", () => {
    const dto = toEntitlementStatusDto({
      state: "active",
      expiresAt: "2030-01-01T00:00:00.000Z",
      refreshAfter: "2026-07-17T00:00:00.000Z",
      deviceName: "Test MacBook",
      deviceId: "33333333-3333-4333-8333-333333333333",
      activationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recoveryAction: "none",
      lastError: null,
      authoritativeState: "none",
    });
    expect(dtoOmitsInternalFields(dto)).toBe(true);
    expect(dto).toEqual({
      state: "active",
      expiresAt: "2030-01-01T00:00:00.000Z",
      refreshAfter: "2026-07-17T00:00:00.000Z",
      deviceName: "Test MacBook",
      activeDevices: null,
      seatLimit: 3,
      devices: [],
      recoveryAction: "none",
      errorCode: null,
      errorMessage: null,
    });
    assertNoEntitlementSecrets(dto);
  });

  it("includes redacted seat-limit device summaries only", () => {
    const dto = toEntitlementStatusDto(
      {
        state: "seat_limit",
        expiresAt: null,
        refreshAfter: null,
        deviceName: "This Device",
        deviceId: "should-not-appear",
        activationId: null,
        recoveryAction: "portal",
        lastError: {
          code: "seat_limit",
          state: "seat_limit",
          recoveryAction: "portal",
          retryable: false,
          message: "All device seats are in use",
        },
        authoritativeState: "none",
      },
      {
        activeDevices: 3,
        devices: [
          {
            name: "Work Mac",
            platform: "darwin",
            architecture: "arm64",
            lastSeenAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    );
    expect(dto.activeDevices).toBe(3);
    expect(dto.devices).toHaveLength(1);
    expect(dto.errorCode).toBe("seat_limit");
    expect(JSON.stringify(dto)).not.toContain("should-not-appear");
    assertNoEntitlementSecrets(dto);
  });
});

describe("assertNoEntitlementSecrets", () => {
  it("rejects GD3 product keys and private key material", () => {
    expect(() =>
      assertNoEntitlementSecrets({ key: VALID_GD3 }),
    ).toThrow(/product key/);
    expect(() =>
      assertNoEntitlementSecrets({
        privatePkcs8Base64: leaseDoc.keys.device.privatePkcs8Base64,
      }),
    ).toThrow(/private key/);
    expect(() =>
      assertNoEntitlementSecrets({ deviceId: "x" }),
    ).toThrow(/deviceId/);
  });
});

describe("createEntitlementIpcHandlers", () => {
  const previousLeaseJwks = process.env.GROKDESK_LEASE_PUBLIC_JWKS;
  let tmp: string;
  let vault: OsCredentialVault;
  let stateStore: EntitlementStateStore;
  let manager: EntitlementManager;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.GROKDESK_LEASE_PUBLIC_JWKS = JSON.stringify([
      {
        kty: "OKP",
        crv: "Ed25519",
        x: leaseDoc.keys.lease.publicJwk.x,
        kid: leaseDoc.keys.lease.kid,
        alg: "EdDSA",
        use: "sig",
      },
    ]);
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ent-ipc-"));
    vault = createMemoryCredentialVault();
    const identity = vectorIdentity();
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
    stateStore = new EntitlementStateStore(defaultEntitlementStatePath(tmp));
    fetchMock = vi.fn();
    const client = new EntitlementClient({
      baseUrl: new URL("https://entitlement.test/"),
      userAgent: "GrokDesk/0.0.0-test",
      fetch: fetchMock as unknown as typeof fetch,
    });
    manager = createEntitlementManager({
      vault,
      stateStore,
      client,
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "14.0",
        deskVersion: "0.0.0-test",
      },
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      now: () => new Date(FIXED_NOW_MS),
      refresh: {
        setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimer: () => {},
        randomUnit: () => 0,
      },
    });
  });

  afterEach(() => {
    manager.stop();
    if (previousLeaseJwks === undefined) {
      delete process.env.GROKDESK_LEASE_PUBLIC_JWKS;
    } else {
      process.env.GROKDESK_LEASE_PUBLIC_JWKS = previousLeaseJwks;
    }
    vi.restoreAllMocks();
  });

  it("status never returns product key, private key, or lease", async () => {
    const lease = await mintLease();
    const identity = vectorIdentity();
    await vault.set(PRODUCT_KEY_ACCOUNT, VALID_GD3);
    await stateStore.write({
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: leaseDoc.claims.deviceThumbprint,
      lease,
      authoritativeState: "none",
      updatedAt: new Date(FIXED_NOW_MS).toISOString(),
      requestId: null,
    });
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        keys: [
          {
            kty: "OKP",
            crv: "Ed25519",
            x: leaseDoc.keys.lease.publicJwk.x,
            kid: leaseDoc.keys.lease.kid,
            alg: "EdDSA",
            use: "sig",
          },
        ],
      }),
    );
    await manager.initialize();

    const handlers = createEntitlementIpcHandlers({
      manager,
      vault,
      stateStore,
      readClipboardText: async () => `copied: ${VALID_GD3}`,
      readImportedKeyText: async () => `saved key\n${VALID_GD3}\n`,
      now: () => new Date(FIXED_NOW_MS),
    });
    const dto = await handlers.status();
    assertNoEntitlementSecrets(dto);
    expect(dtoOmitsInternalFields(dto)).toBe(true);
    expect(JSON.stringify(dto)).not.toContain(VALID_GD3);
    expect(JSON.stringify(dto)).not.toContain(
      leaseDoc.keys.device.privatePkcs8Base64,
    );
    expect(JSON.stringify(dto)).not.toContain(lease);
    // Product key remains only in vault.
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);
  });

  it("activate accepts a key once and returns only status dto", async () => {
    const lease = await mintLease({ jti: "jti-act-ipc" });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("well-known") || url.includes("grokdesk-keys")) {
        return jsonResponse(200, {
          keys: [
            {
              kty: "OKP",
              crv: "Ed25519",
              x: leaseDoc.keys.lease.publicJwk.x,
              kid: leaseDoc.keys.lease.kid,
              alg: "EdDSA",
              use: "sig",
            },
          ],
        });
      }
      if (url.includes("challenges") && !url.includes("deactivation")) {
        return jsonResponse(200, {
          challengeId: "11111111-1111-4111-8111-111111111111",
          nonce: "dGVzdC1ub25jZQ",
          expiresAt: "2030-01-01T00:00:00.000Z",
          serverTime: new Date(FIXED_NOW_MS).toISOString(),
        });
      }
      if (url.endsWith("/v1/activations") || url.includes("/v1/activations")) {
        return jsonResponse(200, {
          activationId: leaseDoc.claims.activationId,
          entitlementId: leaseDoc.claims.entitlementId,
          seatSlot: 1,
          lease,
          serverTime: new Date(FIXED_NOW_MS).toISOString(),
        });
      }
      return jsonResponse(404, { code: "service_unavailable", message: "x", requestId: "r" });
    });

    await manager.initialize();
    const handlers = createEntitlementIpcHandlers({
      manager,
      vault,
      stateStore,
      now: () => new Date(FIXED_NOW_MS),
    });

    const dto = await handlers.activate({ productKey: VALID_GD3 });
    assertNoEntitlementSecrets(dto);
    expect(JSON.stringify(dto)).not.toContain(VALID_GD3);
    expect(JSON.stringify(dto)).not.toContain(lease);
    expect(dto.state === "active" || dto.state === "refresh_due").toBe(true);
    // Key stored in vault only after successful activation.
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);

    const pasted = await handlers.activateFromClipboard();
    const imported = await handlers.activateFromFile();
    assertNoEntitlementSecrets(pasted);
    assertNoEntitlementSecrets(imported);
    expect(JSON.stringify([pasted, imported])).not.toContain(VALID_GD3);
  });

  it("deactivate clears product key and lease without returning secrets", async () => {
    const lease = await mintLease({ jti: "jti-deact" });
    const identity = vectorIdentity();
    await vault.set(PRODUCT_KEY_ACCOUNT, VALID_GD3);
    await stateStore.write({
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: leaseDoc.claims.deviceThumbprint,
      lease,
      authoritativeState: "none",
      updatedAt: new Date(FIXED_NOW_MS).toISOString(),
      requestId: null,
    });
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        keys: [
          {
            kty: "OKP",
            crv: "Ed25519",
            x: leaseDoc.keys.lease.publicJwk.x,
            kid: leaseDoc.keys.lease.kid,
            alg: "EdDSA",
            use: "sig",
          },
        ],
      }),
    );
    await manager.initialize();

    const handlers = createEntitlementIpcHandlers({
      manager,
      vault,
      stateStore,
      now: () => new Date(FIXED_NOW_MS),
    });
    const dto = await handlers.deactivate();
    assertNoEntitlementSecrets(dto);
    expect(JSON.stringify(dto)).not.toContain(VALID_GD3);
    expect(JSON.stringify(dto)).not.toContain(lease);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
    const state = await stateStore.read();
    expect(state?.lease).toBeNull();
    expect(state?.authoritativeState).toBe("device_deactivated");
    expect(dto.state).toBe("device_deactivated");
  });

  it("registerEntitlementIpc wires main channels without secret responses", async () => {
    const handlers = createEntitlementIpcHandlers({
      manager,
      vault,
      stateStore,
      now: () => new Date(FIXED_NOW_MS),
    });
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = {
      handle(channel, listener) {
        registered.set(channel, listener as (...args: unknown[]) => unknown);
      },
      removeHandler(channel) {
        registered.delete(channel);
      },
    };
    registerEntitlementIpc(ipcMain, handlers, () => {
      /* trusted test sender */
    });
    expect(registered.has(ENTITLEMENT_MAIN_IPC_CHANNELS.status)).toBe(true);
    expect(registered.has(ENTITLEMENT_MAIN_IPC_CHANNELS.activate)).toBe(true);
    expect(
      registered.has(ENTITLEMENT_MAIN_IPC_CHANNELS.activateFromClipboard),
    ).toBe(true);
    expect(
      registered.has(ENTITLEMENT_MAIN_IPC_CHANNELS.activateFromFile),
    ).toBe(true);
    expect(registered.has(ENTITLEMENT_MAIN_IPC_CHANNELS.deactivate)).toBe(true);
    expect(registered.has(ENTITLEMENT_MAIN_IPC_CHANNELS.refresh)).toBe(true);

    fetchMock.mockResolvedValue(
      jsonResponse(200, { keys: [] }),
    );
    await manager.initialize();
    const status = await registered.get(ENTITLEMENT_MAIN_IPC_CHANNELS.status)!(
      {},
    );
    assertNoEntitlementSecrets(status);

    unregisterEntitlementIpc(ipcMain);
    expect(registered.size).toBe(0);
  });

  it("registerEntitlementIpc fails closed when assertSender is missing", async () => {
    const handlers = createEntitlementIpcHandlers({
      manager,
      vault,
      stateStore,
      now: () => new Date(FIXED_NOW_MS),
    });
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = {
      handle(channel, listener) {
        registered.set(channel, listener as (...args: unknown[]) => unknown);
      },
      removeHandler(channel) {
        registered.delete(channel);
      },
    };
    registerEntitlementIpc(ipcMain, handlers);
    await expect(
      registered.get(ENTITLEMENT_MAIN_IPC_CHANNELS.status)!({}),
    ).rejects.toThrow(/assertSender not configured/);
    unregisterEntitlementIpc(ipcMain);
  });
});
