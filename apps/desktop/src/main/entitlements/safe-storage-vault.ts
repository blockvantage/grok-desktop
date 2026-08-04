/**
 * Credential vault: AES-256-GCM secrets in a file under userData, keyed by a
 * local key file the app owns (no Keychain / keytar / Electron safeStorage).
 *
 * Why not Keychain / safeStorage?
 * - keytar binds each item to the app code signature → macOS "wants to use
 *   your keychain" ACL prompts on every unsigned rebuild / signature change.
 * - Electron `safeStorage` on macOS still uses Keychain material under the
 *   hood and can surface the same trust-eroding prompts.
 *
 * This vault stores:
 * - `userData/credential-vault/.key` — 32 random bytes (mode 0o600)
 * - `userData/entitlement-vault.enc` — JSON of per-account ciphertexts
 *
 * Fail-closed: never writes plaintext secrets. Corrupt/missing files yield
 * empty vault or `credential_store_failure`, never a crash loop.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CredentialStoreError,
  DEVICE_IDENTITY_ACCOUNT,
  PRODUCT_KEY_ACCOUNT,
  type CredentialAccount,
} from "./types.js";
import type { OsCredentialVault } from "./os-credential-vault.js";

export type CreateSafeStorageVaultOptions = {
  /** Directory for the vault + key — `app.getPath("userData")`. */
  userDataDir: string;
  /** Override the vault file name (tests). */
  fileName?: string;
  /** Override the key file relative path (tests). */
  keyFileName?: string;
  /**
   * @deprecated Ignored. Kept so older call sites / tests that passed a
   * safeStorage double still construct; encryption is always local-file AES.
   */
  safeStorage?: unknown;
};

const DEFAULT_VAULT_FILE = "entitlement-vault.enc";
const DEFAULT_KEY_FILE = path.join("credential-vault", ".key");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGO = "aes-256-gcm" as const;

const ALLOWED_ACCOUNTS = new Set<string>([
  PRODUCT_KEY_ACCOUNT,
  DEVICE_IDENTITY_ACCOUNT,
]);

function assertAccount(account: string): asserts account is CredentialAccount {
  if (!ALLOWED_ACCOUNTS.has(account)) {
    throw new CredentialStoreError(
      "credential_store_failure: unsupported account",
    );
  }
}

/** Per-account sealed box (iv + auth tag + ciphertext), all base64. */
type SealedAccount = {
  v: 2;
  iv: string;
  tag: string;
  ct: string;
};

type VaultFileV2 = {
  version: 2;
  accounts: Record<string, SealedAccount>;
};

function emptyVault(): VaultFileV2 {
  return { version: 2, accounts: {} };
}

function isSealedAccount(value: unknown): value is SealedAccount {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    o.v === 2 &&
    typeof o.iv === "string" &&
    typeof o.tag === "string" &&
    typeof o.ct === "string"
  );
}

/**
 * Local-file credential vault (AES-256-GCM + key file).
 * Exported under the historical `SafeStorageCredentialVault` name so existing
 * imports keep working; it no longer touches Electron safeStorage.
 */
export class SafeStorageCredentialVault implements OsCredentialVault {
  private readonly filePath: string;
  private readonly keyPath: string;
  private key: Buffer | null = null;
  /** Single-flight key load/create so concurrent first-writes share one key. */
  private keyLoad: Promise<Buffer> | null = null;
  /** Single-writer lock: serializes read-modify-write of the vault file. */
  private writeChain: Promise<unknown> = Promise.resolve();
  private tmpSeq = 0;

  constructor(filePath: string, keyPath: string) {
    if (!filePath || !keyPath) {
      throw new CredentialStoreError("credential_store_failure");
    }
    this.filePath = filePath;
    this.keyPath = keyPath;
  }

  private enqueueWrite<T>(mutate: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(mutate, mutate);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    if (this.key) return this.key;
    if (!this.keyLoad) {
      this.keyLoad = this.loadOrCreateKeyUncached().catch((err) => {
        this.keyLoad = null;
        throw err;
      });
    }
    return this.keyLoad;
  }

  private async loadOrCreateKeyUncached(): Promise<Buffer> {
    try {
      const raw = await fs.readFile(this.keyPath);
      if (raw.length !== KEY_BYTES) {
        throw new CredentialStoreError("credential_store_failure");
      }
      this.key = raw;
      return raw;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        if (err instanceof CredentialStoreError) throw err;
        throw new CredentialStoreError("credential_store_failure");
      }
    }
    // First use: create a fresh key the app owns (no Keychain).
    // wx: exclusive create — if another process wins the race, re-read.
    const generated = randomBytes(KEY_BYTES);
    try {
      await fs.mkdir(path.dirname(this.keyPath), {
        recursive: true,
        mode: 0o700,
      });
      await fs.writeFile(this.keyPath, generated, { mode: 0o600, flag: "wx" });
      this.key = generated;
      return generated;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
        const raw = await fs.readFile(this.keyPath);
        if (raw.length !== KEY_BYTES) {
          throw new CredentialStoreError("credential_store_failure");
        }
        this.key = raw;
        return raw;
      }
      throw new CredentialStoreError("credential_store_failure");
    }
  }

  private seal(plain: string, key: Buffer): SealedAccount {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([
      cipher.update(plain, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      v: 2,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ct: ct.toString("base64"),
    };
  }

  private open(sealed: SealedAccount, key: Buffer): string {
    const iv = Buffer.from(sealed.iv, "base64");
    const tag = Buffer.from(sealed.tag, "base64");
    const ct = Buffer.from(sealed.ct, "base64");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  }

  private async readVault(): Promise<VaultFileV2> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return emptyVault();
      throw new CredentialStoreError("credential_store_failure");
    }
    try {
      const parsed = JSON.parse(raw) as Partial<VaultFileV2> & {
        version?: number;
        accounts?: Record<string, unknown>;
      };
      // v1 was Electron safeStorage base64 strings — unreadable without
      // Keychain material; treat as empty so the user re-activates cleanly.
      if (!parsed || parsed.version !== 2 || typeof parsed.accounts !== "object") {
        return emptyVault();
      }
      const accounts: Record<string, SealedAccount> = {};
      for (const [k, v] of Object.entries(parsed.accounts ?? {})) {
        if (isSealedAccount(v)) accounts[k] = v;
      }
      return { version: 2, accounts };
    } catch {
      return emptyVault();
    }
  }

  private async writeVault(vault: VaultFileV2): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.${this.tmpSeq++}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(vault), { mode: 0o600 });
      await fs.rename(tmp, this.filePath);
    } catch {
      try {
        await fs.rm(tmp, { force: true });
      } catch {
        /* best-effort cleanup */
      }
      throw new CredentialStoreError("credential_store_failure");
    }
  }

  async get(account: CredentialAccount): Promise<string | null> {
    assertAccount(account);
    const vault = await this.readVault();
    const sealed = vault.accounts[account];
    if (sealed == null) return null;
    const key = await this.loadOrCreateKey();
    try {
      return this.open(sealed, key);
    } catch {
      throw new CredentialStoreError("credential_store_failure");
    }
  }

  async set(account: CredentialAccount, value: string): Promise<void> {
    assertAccount(account);
    if (typeof value !== "string") {
      throw new CredentialStoreError("credential_store_failure");
    }
    const key = await this.loadOrCreateKey();
    const sealed = this.seal(value, key);
    await this.enqueueWrite(async () => {
      const vault = await this.readVault();
      vault.accounts[account] = sealed;
      await this.writeVault(vault);
    });
  }

  async delete(account: CredentialAccount): Promise<boolean> {
    assertAccount(account);
    return this.enqueueWrite(async () => {
      const vault = await this.readVault();
      if (!(account in vault.accounts)) return false;
      delete vault.accounts[account];
      await this.writeVault(vault);
      return true;
    });
  }
}

/**
 * Production factory: local file + key under `userDataDir`.
 * Never uses Keychain, keytar, or Electron safeStorage.
 */
export function createSafeStorageCredentialVault(
  options: CreateSafeStorageVaultOptions,
): OsCredentialVault {
  if (!options?.userDataDir || typeof options.userDataDir !== "string") {
    throw new CredentialStoreError("credential_store_failure");
  }
  const filePath = path.join(
    options.userDataDir,
    options.fileName ?? DEFAULT_VAULT_FILE,
  );
  const keyPath = path.join(
    options.userDataDir,
    options.keyFileName ?? DEFAULT_KEY_FILE,
  );
  return new SafeStorageCredentialVault(filePath, keyPath);
}

/** @deprecated No longer used; kept so accidental imports fail closed loudly. */
export function loadElectronSafeStorage(): never {
  throw new CredentialStoreError(
    "credential_store_failure: safeStorage vault removed; use file vault",
  );
}

/** Historical type alias — vault no longer depends on Electron safeStorage. */
export type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
};
