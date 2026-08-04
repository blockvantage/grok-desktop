import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EntitlementClient } from "@grokdesk/entitlement-client";
import {
  ACTIVATE_PREFIX,
  buildProofSigningMaterial,
  rfc7638JwkThumbprint,
  verifyActivationProof,
  verifyDeviceLease,
} from "@grokdesk/license";
import {
  buildActivationPayload,
  createActivationFlow,
  peekJwtKid,
  PEEK_JWT_MAX_CHARS,
  signActivationProof,
  type ActivationFlowDeps,
} from "./activation-flow.js";
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
import { PRODUCT_KEY_ACCOUNT, type DeviceIdentityRecord } from "./types.js";

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

const FIXED_NOW = new Date(leaseDoc.fixedClockSeconds * 1000);


function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function vectorDeviceIdentity(): DeviceIdentity {
  const publicJwk = {
    kty: "OKP" as const,
    crv: "Ed25519" as const,
    x: leaseDoc.keys.device.publicJwk.x,
  };
  const record: DeviceIdentityRecord = {
    schema: 1,
    deviceId: "33333333-3333-4333-8333-333333333333",
    publicJwk,
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
  activationId?: string;
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
  const now = leaseDoc.fixedClockSeconds;
  return new jose.SignJWT({
    entitlementId: leaseDoc.claims.entitlementId,
    activationId: overrides.activationId ?? leaseDoc.claims.activationId,
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
    .setJti(overrides.jti ?? "lease-jti-minted-001")
    .sign(key);
}

describe("activation proof helpers", () => {
  it("builds contract canonical payload and signs with device private key", () => {
    const identity = vectorDeviceIdentity();
    const payload = buildActivationPayload({
      challengeId: "22222222-2222-4222-8222-222222222222",
      nonce: "challenge-nonce-fixed-001",
      identity,
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0.0",
        deskVersion: "1.0.0",
      },
    });
    const signature = signActivationProof(identity.privateKey, payload);
    const material = buildProofSigningMaterial(ACTIVATE_PREFIX, payload);
    expect(material.signingString.startsWith("GROKDESK-ACTIVATE-V1\n")).toBe(
      true,
    );
    expect(
      verifyActivationProof({
        payload,
        signatureBase64Url: signature,
        nowMs: FIXED_NOW.getTime(),
        challengeExpiresAtMs: FIXED_NOW.getTime() + 60_000,
      }).ok,
    ).toBe(true);
    expect(rfc7638JwkThumbprint(identity.publicJwk)).toBe(
      leaseDoc.claims.deviceThumbprint,
    );
  });

  it("peekJwtKid rejects oversized or malformed compact JWS", () => {
    expect(peekJwtKid("")).toBeNull();
    expect(peekJwtKid("a".repeat(PEEK_JWT_MAX_CHARS + 1))).toBeNull();
    expect(peekJwtKid("not-a-jwt")).toBeNull();
    const header = Buffer.from(
      JSON.stringify({ alg: "EdDSA", kid: "lease-1" }),
    ).toString("base64url");
    expect(peekJwtKid(`${header}.payload.sig`)).toBe("lease-1");
    const hugeHeader = Buffer.from("x".repeat(2_000)).toString("base64url");
    expect(peekJwtKid(`${hugeHeader}.p.s`)).toBeNull();
  });
});

describe("activation flow", () => {
  let root: string;
  let vault: OsCredentialVault;
  let store: EntitlementStateStore;
  let identity: DeviceIdentity;
  let fetchImpl: ReturnType<typeof vi.fn>;
  let client: EntitlementClient;
  let deps: ActivationFlowDeps;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "gd-act-"));
    vault = createMemoryCredentialVault();
    store = new EntitlementStateStore(defaultEntitlementStatePath(root));
    identity = vectorDeviceIdentity();
    // Persist identity for vault product-key isolation checks.
    await vault.set(
      "device-identity/v1",
      JSON.stringify({
        schema: 1,
        deviceId: identity.deviceId,
        publicJwk: identity.publicJwk,
        privatePkcs8Base64: identity.privatePkcs8Base64,
        createdAt: identity.createdAt,
        displayName: identity.displayName,
      }),
    );

    fetchImpl = vi.fn();
    client = new EntitlementClient({
      baseUrl: new URL("https://entitlements.example.invalid/"),
      fetch: fetchImpl as unknown as typeof fetch,
      userAgent: "GrokDesk-Test/1.0.0",
    });

    deps = {
      client,
      vault,
      stateStore: store,
      getIdentity: async () => identity,
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0.0",
        deskVersion: "1.0.0",
      },
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
      now: () => FIXED_NOW,
    };
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  function mockSuccessfulActivation(lease: string) {
    fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v1/activations/challenges")) {
        return jsonResponse(200, {
          challengeId: "22222222-2222-4222-8222-222222222222",
          nonce: "challenge-nonce-fixed-001",
          expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
          serverTime: FIXED_NOW.toISOString(),
        });
      }
      if (u.endsWith("/v1/activations") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          productKey: string;
          signature: string;
          challengeId: string;
          deviceId: string;
        };
        expect(body.productKey).toBe(VALID_GD3);
        expect(body.challengeId).toBe(
          "22222222-2222-4222-8222-222222222222",
        );
        expect(body.deviceId).toBe(identity.deviceId);
        expect(body.signature.length).toBeGreaterThan(40);
        return jsonResponse(
          200,
          {
            activationId: leaseDoc.claims.activationId,
            entitlementId: leaseDoc.claims.entitlementId,
            seatSlot: 1,
            lease,
            serverTime: FIXED_NOW.toISOString(),
          },
          { "x-request-id": "req-activate-1" },
        );
      }
      return jsonResponse(404, {
        code: "service_unavailable",
        message: "not found",
        requestId: "x",
      });
    });
  }

  it("activates with challenge proof, verifies lease, stores key and state", async () => {
    const lease = await mintLease();
    mockSuccessfulActivation(lease);
    const flow = createActivationFlow(deps);
    const result = await flow.activate(`Here is your key:\n ${VALID_GD3} \n`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.deviceThumbprint).toBe(
      leaseDoc.claims.deviceThumbprint,
    );
    expect(result.state.lease).toBe(lease);
    expect(result.state.authoritativeState).toBe("none");
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);
    const onDisk = await store.read();
    expect(onDisk?.lease).toBe(lease);
    expect(onDisk?.devicePublicKeyThumbprint).toBe(
      leaseDoc.claims.deviceThumbprint,
    );
    // No secrets other than lease token on disk.
    const raw = await fsp.readFile(store.path, "utf8");
    expect(raw).not.toContain("GD3.");
    expect(raw).not.toContain(identity.privatePkcs8Base64);
  });

  it("does not store an invalid key on invalid_key_signature", async () => {
    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/v1/activations/challenges")) {
        return jsonResponse(200, {
          challengeId: "22222222-2222-4222-8222-222222222222",
          nonce: "n",
          expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
          serverTime: FIXED_NOW.toISOString(),
        });
      }
      return jsonResponse(401, {
        code: "invalid_key_signature",
        message: "Product key signature is invalid",
        requestId: "req-bad",
      });
    });
    const flow = createActivationFlow(deps);
    const result = await flow.activate(VALID_GD3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_key_signature");
    expect(result.keyStored).toBe(false);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it("stores key on seat_limit for retry without writing a lease", async () => {
    fetchImpl.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/v1/activations/challenges")) {
        return jsonResponse(200, {
          challengeId: "22222222-2222-4222-8222-222222222222",
          nonce: "n",
          expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
          serverTime: FIXED_NOW.toISOString(),
        });
      }
      return jsonResponse(409, {
        code: "seat_limit",
        message: "All device seats are in use",
        requestId: "req-seat",
      });
    });
    const flow = createActivationFlow(deps);
    const result = await flow.activate(VALID_GD3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("seat_limit");
    expect(result.error.recoveryAction).toBe("portal");
    expect(result.keyStored).toBe(true);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);
    expect(await store.read()).toBeNull();
  });

  it("does not store key when returned lease fails local verify", async () => {
    // Wrong device thumbprint on lease.
    const badLease = await mintLease({
      deviceThumbprint: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    mockSuccessfulActivation(badLease);
    const flow = createActivationFlow(deps);
    const result = await flow.activate(VALID_GD3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.keyStored).toBe(false);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it("single-flights concurrent activate (double-click)", async () => {
    let activationCalls = 0;
    let releaseActivation: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseActivation = resolve;
    });

    fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/v1/activations/challenges")) {
        return jsonResponse(200, {
          challengeId: "22222222-2222-4222-8222-222222222222",
          nonce: "n",
          expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
          serverTime: FIXED_NOW.toISOString(),
        });
      }
      if (String(url).endsWith("/v1/activations") && init?.method === "POST") {
        activationCalls += 1;
        await gate;
        const lease = leaseDoc.expectedLease;
        // expectedLease is for vector device — matches our identity.
        const verified = await verifyDeviceLease(lease, {
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
        return jsonResponse(200, {
          activationId: leaseDoc.claims.activationId,
          entitlementId: leaseDoc.claims.entitlementId,
          seatSlot: 1,
          lease,
          serverTime: FIXED_NOW.toISOString(),
        });
      }
      return jsonResponse(500, {
        code: "service_unavailable",
        message: "x",
        requestId: "e",
      });
    });

    const flow = createActivationFlow(deps);
    const p1 = flow.activate(VALID_GD3);
    const p2 = flow.activate(VALID_GD3);
    expect(flow.isInFlight()).toBe(true);
    releaseActivation!();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(activationCalls).toBe(1);
  });

  it("retries after lost response without storing invalid intermediate state", async () => {
    let attempts = 0;
    fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/v1/activations/challenges")) {
        return jsonResponse(200, {
          challengeId: "22222222-2222-4222-8222-222222222222",
          nonce: `nonce-${attempts}`,
          expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
          serverTime: FIXED_NOW.toISOString(),
        });
      }
      if (String(url).endsWith("/v1/activations") && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) {
          // Simulate network loss after server may have processed.
          throw new TypeError("network down");
        }
        return jsonResponse(200, {
          activationId: leaseDoc.claims.activationId,
          entitlementId: leaseDoc.claims.entitlementId,
          seatSlot: 1,
          lease: leaseDoc.expectedLease,
          serverTime: FIXED_NOW.toISOString(),
        });
      }
      return jsonResponse(500, {
        code: "service_unavailable",
        message: "x",
        requestId: "e",
      });
    });

    const flow = createActivationFlow(deps);
    const first = await flow.activate(VALID_GD3);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.code).toBe("service_unavailable");
    expect(first.keyStored).toBe(false);
    expect(await store.read()).toBeNull();

    const second = await flow.activate(VALID_GD3);
    expect(second.ok).toBe(true);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);
  });

  it("rejects free-form input with multiple GD3 tokens without network", async () => {
    const flow = createActivationFlow(deps);
    const result = await flow.activate(`${VALID_GD3} and ${VALID_GD3}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_key_format");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
