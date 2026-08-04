import { describe, it, expect, beforeEach } from "vitest";
import { createPublicKey } from "node:crypto";
import { hostname } from "node:os";
import {
  createAndStoreDeviceIdentity,
  generateDeviceKeyMaterial,
  loadDeviceIdentity,
  loadOrCreateDeviceIdentity,
  parseDeviceIdentityRecord,
  reconstructDeviceIdentity,
} from "./device-identity.js";
import {
  createMemoryCredentialVault,
  type OsCredentialVault,
} from "./os-credential-vault.js";
import {
  CredentialStoreError,
  DEVICE_IDENTITY_ACCOUNT,
  type DeviceIdentityRecord,
} from "./types.js";


const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("device identity", () => {
  let vault: OsCredentialVault;

  beforeEach(() => {
    vault = createMemoryCredentialVault();
  });

  it("first run generates UUIDv4 + Ed25519 and stores schema-1 record", async () => {
    const identity = await loadOrCreateDeviceIdentity(vault, {
      displayName: "Test Desk",
      now: () => new Date("2026-07-16T12:00:00.000Z"),
    });

    expect(identity.schema).toBe(1);
    expect(identity.deviceId).toMatch(UUID_V4_RE);
    expect(identity.publicJwk).toEqual({
      kty: "OKP",
      crv: "Ed25519",
      x: expect.any(String),
    });
    expect(identity.publicJwk.x.length).toBeGreaterThan(20);
    expect(identity.privatePkcs8Base64.length).toBeGreaterThan(20);
    expect(identity.createdAt).toBe("2026-07-16T12:00:00.000Z");
    expect(identity.displayName).toBe("Test Desk");
    expect(identity.privateKey.type).toBe("private");
    expect(identity.publicKey.type).toBe("public");

    const raw = await vault.get(DEVICE_IDENTITY_ACCOUNT);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw!) as DeviceIdentityRecord;
    expect(stored.schema).toBe(1);
    expect(stored.deviceId).toBe(identity.deviceId);
    expect(stored.privatePkcs8Base64).toBe(identity.privatePkcs8Base64);
  });

  it("reuses the same identity across loadOrCreate calls (stable reuse)", async () => {
    const first = await loadOrCreateDeviceIdentity(vault);
    const second = await loadOrCreateDeviceIdentity(vault);
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.publicJwk).toEqual(first.publicJwk);
    expect(second.privatePkcs8Base64).toBe(first.privatePkcs8Base64);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("reconstructs KeyObjects and metadata from stored record", async () => {
    const created = await createAndStoreDeviceIdentity(vault, {
      displayName: "Reconstruct Me",
    });
    const loaded = await loadDeviceIdentity(vault);
    expect(loaded).not.toBeNull();
    expect(loaded!.deviceId).toBe(created.deviceId);
    expect(loaded!.displayName).toBe("Reconstruct Me");
    expect(loaded!.publicJwk).toEqual(created.publicJwk);
    expect(loaded!.privateKey.asymmetricKeyType).toBe("ed25519");
    expect(loaded!.publicKey.asymmetricKeyType).toBe("ed25519");

    const record = parseDeviceIdentityRecord(
      (await vault.get(DEVICE_IDENTITY_ACCOUNT))!,
    );
    const reconstructed = reconstructDeviceIdentity(record);
    expect(reconstructed.deviceId).toBe(created.deviceId);
    expect(reconstructed.publicJwk.x).toBe(created.publicJwk.x);
  });

  it("refuses to regenerate when a lease exists but private key is missing", async () => {
    // Empty vault + lease present → cannot invent a new device key.
    await expect(
      loadOrCreateDeviceIdentity(vault, { hasLease: () => true }),
    ).rejects.toMatchObject({ code: "credential_store_failure" });

    // Partial record with public metadata but empty private key + lease.
    const partial = {
      schema: 1,
      deviceId: "550e8400-e29b-41d4-a716-446655440000",
      publicJwk: { kty: "OKP", crv: "Ed25519", x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      privatePkcs8Base64: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      displayName: "Broken",
    };
    await vault.set(DEVICE_IDENTITY_ACCOUNT, JSON.stringify(partial));
    await expect(
      loadOrCreateDeviceIdentity(vault, { hasLease: () => true }),
    ).rejects.toBeInstanceOf(CredentialStoreError);

    // Ensure we did not overwrite with a new identity.
    const still = await vault.get(DEVICE_IDENTITY_ACCOUNT);
    expect(JSON.parse(still!).deviceId).toBe(partial.deviceId);
  });

  it("fails hard on corrupt JSON (no silent plaintext recovery)", async () => {
    await vault.set(DEVICE_IDENTITY_ACCOUNT, "{not-json");
    await expect(loadOrCreateDeviceIdentity(vault)).rejects.toMatchObject({
      code: "credential_store_failure",
    });
    await expect(loadDeviceIdentity(vault)).rejects.toMatchObject({
      code: "credential_store_failure",
    });
  });

  it("fails on schema/field corruption", async () => {
    await vault.set(
      DEVICE_IDENTITY_ACCOUNT,
      JSON.stringify({ schema: 99, deviceId: "x" }),
    );
    await expect(loadDeviceIdentity(vault)).rejects.toBeInstanceOf(
      CredentialStoreError,
    );
  });

  it("never derives deviceId from hostname or environment fingerprint", async () => {
    const host = hostname();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const fresh = createMemoryCredentialVault();
      const id = await loadOrCreateDeviceIdentity(fresh);
      ids.add(id.deviceId);
      expect(id.deviceId).not.toBe(host);
      expect(id.deviceId).not.toContain(host);
      expect(id.deviceId).toMatch(UUID_V4_RE);
      // Not a hash of platform bits.
      expect(id.deviceId).not.toMatch(new RegExp(process.platform, "i"));
      expect(id.privatePkcs8Base64).not.toContain(host);
    }
    expect(ids.size).toBe(5);
  });

  it("propagates vault failures as credential_store_failure", async () => {
    const failing: OsCredentialVault = {
      get: async () => {
        throw new Error("vault down");
      },
      set: async () => {
        throw new Error("vault down");
      },
      delete: async () => false,
    };
    await expect(loadOrCreateDeviceIdentity(failing)).rejects.toMatchObject({
      code: "credential_store_failure",
    });
  });

  it("generateDeviceKeyMaterial returns matching Ed25519 pair", () => {
    const m = generateDeviceKeyMaterial();
    expect(m.publicJwk.kty).toBe("OKP");
    expect(m.publicJwk.crv).toBe("Ed25519");
    const pub = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: m.publicJwk.x,
      },
      format: "jwk",
    });
    expect(pub.asymmetricKeyType).toBe("ed25519");
  });
});
