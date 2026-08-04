/**
 * Credential vault interface shared by entitlement services.
 *
 * **Production must use `createSafeStorageCredentialVault` (AES file under
 * userData)** — see `safe-storage-vault.ts`.
 *
 * DO NOT reintroduce OS Keychain, Windows Credential Manager, the keytar
 * native module, or Electron safeStorage: unsigned rebuilds and signature
 * changes trigger macOS "allow keychain access" prompts that are overkill
 * and erode trust for this app. Decision is permanent unless product
 * leadership reopens it (see docs/decisions/2026-07-24-no-keychain.md).
 *
 * This module exports:
 * - `OsCredentialVault` interface
 * - `createMemoryCredentialVault` for unit tests only (never wired in bootstrap)
 */

import {
  CredentialStoreError,
  DEVICE_IDENTITY_ACCOUNT,
  PRODUCT_KEY_ACCOUNT,
  type CredentialAccount,
} from "./types.js";

export type { CredentialAccount };

export interface OsCredentialVault {
  get(account: CredentialAccount): Promise<string | null>;
  set(account: CredentialAccount, value: string): Promise<void>;
  delete(account: CredentialAccount): Promise<boolean>;
}

const ALLOWED_ACCOUNTS = new Set<string>([
  PRODUCT_KEY_ACCOUNT,
  DEVICE_IDENTITY_ACCOUNT,
]);

function assertAccount(account: string): asserts account is CredentialAccount {
  if (!ALLOWED_ACCOUNTS.has(account)) {
    throw new CredentialStoreError(
      `credential_store_failure: unsupported account`,
    );
  }
}

/**
 * In-memory vault for unit tests. Never use in production bootstrap —
 * packaging smoke tests assert bootstrap wires the file vault only.
 */
export function createMemoryCredentialVault(): OsCredentialVault {
  const store = new Map<string, string>();
  return {
    async get(account: CredentialAccount): Promise<string | null> {
      assertAccount(account);
      return store.get(account) ?? null;
    },
    async set(account: CredentialAccount, value: string): Promise<void> {
      assertAccount(account);
      if (typeof value !== "string") {
        throw new CredentialStoreError("credential_store_failure");
      }
      store.set(account, value);
    },
    async delete(account: CredentialAccount): Promise<boolean> {
      assertAccount(account);
      return store.delete(account);
    },
  };
}
