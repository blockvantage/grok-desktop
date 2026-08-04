/**
 * Shared entitlement main-process types for OS credential storage
 * and device identity (desktop entitlement enforcement Task 3).
 */

/** Historical service id (matches appId). Not used for OS Keychain. */
export const CREDENTIAL_SERVICE = "ai.x.grokdesk" as const;

export const PRODUCT_KEY_ACCOUNT = "product-key/v1" as const;
export const DEVICE_IDENTITY_ACCOUNT = "device-identity/v1" as const;

export type CredentialAccount =
  | typeof PRODUCT_KEY_ACCOUNT
  | typeof DEVICE_IDENTITY_ACCOUNT;

export const CREDENTIAL_ACCOUNTS: readonly CredentialAccount[] = [
  PRODUCT_KEY_ACCOUNT,
  DEVICE_IDENTITY_ACCOUNT,
] as const;

/** Ed25519 public JWK stored with device identity. */
export type DevicePublicJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
};

/**
 * Durable device identity payload stored under `device-identity/v1`.
 * UUID and key material are random — never derived from host fingerprints.
 */
export type DeviceIdentityRecord = {
  schema: 1;
  deviceId: string;
  publicJwk: DevicePublicJwk;
  privatePkcs8Base64: string;
  createdAt: string;
  displayName: string;
};

/**
 * Thrown when the credential vault cannot load, is denied, or returns
 * unusable data. Callers map this to desktop license state
 * `credential_store_failure`. Never fall back to OS Keychain, Electron
 * safeStorage, plaintext files, CLI args, or SQLite.
 */
export class CredentialStoreError extends Error {
  readonly code = "credential_store_failure" as const;

  constructor(message = "credential_store_failure") {
    super(message);
    this.name = "CredentialStoreError";
  }
}

export function isCredentialStoreError(
  err: unknown,
): err is CredentialStoreError {
  return (
    err instanceof CredentialStoreError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "credential_store_failure")
  );
}
