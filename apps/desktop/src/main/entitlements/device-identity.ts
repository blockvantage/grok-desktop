/**
 * Random device identity for GD3 activation / lease proofs.
 *
 * First run: UUIDv4 + Ed25519 keypair stored in the OS credential vault.
 * Subsequent runs: stable reuse of the stored record.
 * Never derives identity from hostname, username, OS, or architecture.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import type { OsCredentialVault } from "./os-credential-vault.js";
import {
  CredentialStoreError,
  DEVICE_IDENTITY_ACCOUNT,
  type DeviceIdentityRecord,
  type DevicePublicJwk,
} from "./types.js";

export type DeviceIdentity = {
  schema: 1;
  deviceId: string;
  publicJwk: DevicePublicJwk;
  /** PKCS#8 DER, base64 (as stored). */
  privatePkcs8Base64: string;
  createdAt: string;
  displayName: string;
  /** Reconstructed private key for signing. */
  privateKey: KeyObject;
  /** Reconstructed public key. */
  publicKey: KeyObject;
};

export type DeviceIdentityOptions = {
  /**
   * When true (or resolves true), identity must not be regenerated if the
   * private key is missing — a lease is bound to the prior key.
   */
  hasLease?: () => boolean | Promise<boolean>;
  /** Customer-visible display name (may use OS name; never used for key material). */
  displayName?: string;
  now?: () => Date;
  randomUUID?: () => string;
  generateKeyMaterial?: () => {
    publicJwk: DevicePublicJwk;
    privatePkcs8Base64: string;
  };
};

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isDevicePublicJwk(value: unknown): value is DevicePublicJwk {
  if (!value || typeof value !== "object") return false;
  const j = value as Record<string, unknown>;
  return j.kty === "OKP" && j.crv === "Ed25519" && typeof j.x === "string" && j.x.length > 0;
}

/**
 * Parse and validate a stored device-identity JSON payload.
 * Throws CredentialStoreError on corrupt or incomplete material.
 */
export function parseDeviceIdentityRecord(
  raw: string,
): DeviceIdentityRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CredentialStoreError("credential_store_failure");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CredentialStoreError("credential_store_failure");
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.schema !== 1) {
    throw new CredentialStoreError("credential_store_failure");
  }
  if (typeof rec.deviceId !== "string" || !UUID_V4_RE.test(rec.deviceId)) {
    throw new CredentialStoreError("credential_store_failure");
  }
  if (!isDevicePublicJwk(rec.publicJwk)) {
    throw new CredentialStoreError("credential_store_failure");
  }
  if (
    typeof rec.privatePkcs8Base64 !== "string" ||
    rec.privatePkcs8Base64.length === 0
  ) {
    throw new CredentialStoreError("credential_store_failure");
  }
  if (typeof rec.createdAt !== "string" || !rec.createdAt) {
    throw new CredentialStoreError("credential_store_failure");
  }
  if (typeof rec.displayName !== "string") {
    throw new CredentialStoreError("credential_store_failure");
  }
  return {
    schema: 1,
    deviceId: rec.deviceId,
    publicJwk: {
      kty: "OKP",
      crv: "Ed25519",
      x: rec.publicJwk.x,
    },
    privatePkcs8Base64: rec.privatePkcs8Base64,
    createdAt: rec.createdAt,
    displayName: rec.displayName,
  };
}

/** Reconstruct KeyObjects from a validated record. */
export function reconstructDeviceIdentity(
  record: DeviceIdentityRecord,
): DeviceIdentity {
  try {
    const privateDer = Buffer.from(record.privatePkcs8Base64, "base64");
    if (privateDer.byteLength === 0) {
      throw new CredentialStoreError("credential_store_failure");
    }
    const privateKey = createPrivateKey({
      key: privateDer,
      format: "der",
      type: "pkcs8",
    });
    const publicKey = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: record.publicJwk.x,
      },
      format: "jwk",
    });
    // Sanity: exported public from private must match stored JWK.
    const derived = privateKey.export({ format: "jwk" }) as {
      x?: string;
      crv?: string;
      kty?: string;
    };
    if (
      derived.kty !== "OKP" ||
      derived.crv !== "Ed25519" ||
      derived.x !== record.publicJwk.x
    ) {
      throw new CredentialStoreError("credential_store_failure");
    }
    return {
      schema: 1,
      deviceId: record.deviceId,
      publicJwk: record.publicJwk,
      privatePkcs8Base64: record.privatePkcs8Base64,
      createdAt: record.createdAt,
      displayName: record.displayName,
      privateKey,
      publicKey,
    };
  } catch (err) {
    if (err instanceof CredentialStoreError) throw err;
    throw new CredentialStoreError("credential_store_failure");
  }
}

export function generateDeviceKeyMaterial(): {
  publicJwk: DevicePublicJwk;
  privatePkcs8Base64: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as {
    kty?: string;
    crv?: string;
    x?: string;
  };
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    throw new CredentialStoreError("credential_store_failure");
  }
  const privatePkcs8Base64 = Buffer.from(
    privateKey.export({ format: "der", type: "pkcs8" }),
  ).toString("base64");
  return {
    publicJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x },
    privatePkcs8Base64,
  };
}

function defaultDisplayName(): string {
  // Customer-visible only; never mixed into key derivation.
  const platform =
    process.platform === "darwin"
      ? "macOS"
      : process.platform === "win32"
        ? "Windows"
        : process.platform === "linux"
          ? "Linux"
          : "Desktop";
  return `Grok Desk on ${platform}`;
}

async function resolveHasLease(
  hasLease?: () => boolean | Promise<boolean>,
): Promise<boolean> {
  if (!hasLease) return false;
  return Boolean(await hasLease());
}

/**
 * Load existing device identity from the OS vault, or create one on first run.
 *
 * - Stable reuse when a valid record exists.
 * - Refuses to regenerate when a lease exists but the private key is missing.
 * - Never falls back to non-OS storage.
 */
export async function loadOrCreateDeviceIdentity(
  vault: OsCredentialVault,
  options: DeviceIdentityOptions = {},
): Promise<DeviceIdentity> {
  let raw: string | null;
  try {
    raw = await vault.get(DEVICE_IDENTITY_ACCOUNT);
  } catch (err) {
    if (err instanceof CredentialStoreError) throw err;
    throw new CredentialStoreError("credential_store_failure");
  }

  if (raw !== null && raw !== undefined && raw !== "") {
    // Corrupt / incomplete stored identity → hard failure (do not silently rotate).
    const record = parseDeviceIdentityRecord(raw);
    return reconstructDeviceIdentity(record);
  }

  // Missing entry.
  if (await resolveHasLease(options.hasLease)) {
    throw new CredentialStoreError("credential_store_failure");
  }

  return createAndStoreDeviceIdentity(vault, options);
}

/**
 * Create a fresh random identity and persist it. Caller must ensure no lease
 * is bound to a previous key (see `loadOrCreateDeviceIdentity`).
 */
export async function createAndStoreDeviceIdentity(
  vault: OsCredentialVault,
  options: DeviceIdentityOptions = {},
): Promise<DeviceIdentity> {
  const id =
    options.randomUUID?.() ??
    (() => {
      const u = randomUUID();
      if (!UUID_V4_RE.test(u)) {
        throw new CredentialStoreError("credential_store_failure");
      }
      return u;
    })();
  if (!UUID_V4_RE.test(id)) {
    throw new CredentialStoreError("credential_store_failure");
  }

  const material =
    options.generateKeyMaterial?.() ?? generateDeviceKeyMaterial();
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const displayName = options.displayName ?? defaultDisplayName();

  const record: DeviceIdentityRecord = {
    schema: 1,
    deviceId: id,
    publicJwk: material.publicJwk,
    privatePkcs8Base64: material.privatePkcs8Base64,
    createdAt,
    displayName,
  };

  try {
    await vault.set(DEVICE_IDENTITY_ACCOUNT, JSON.stringify(record));
  } catch (err) {
    if (err instanceof CredentialStoreError) throw err;
    throw new CredentialStoreError("credential_store_failure");
  }

  return reconstructDeviceIdentity(record);
}

/**
 * Load identity without creating. Returns null if absent.
 * Throws on corrupt data or vault failure.
 */
export async function loadDeviceIdentity(
  vault: OsCredentialVault,
): Promise<DeviceIdentity | null> {
  let raw: string | null;
  try {
    raw = await vault.get(DEVICE_IDENTITY_ACCOUNT);
  } catch (err) {
    if (err instanceof CredentialStoreError) throw err;
    throw new CredentialStoreError("credential_store_failure");
  }
  if (raw === null || raw === undefined || raw === "") return null;
  return reconstructDeviceIdentity(parseDeviceIdentityRecord(raw));
}
