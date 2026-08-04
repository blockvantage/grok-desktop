/**
 * Gateway-side credential vault (SEC-02).
 *
 * - Memory: tests / degraded process-local
 * - File AES-GCM: durable under dataDir/credential-vault (0600 key + ciphertext)
 *
 * SQLite stores only opaque vault:<id> refs. OS keychain / Electron safeStorage
 * remains the desktop main-process backend; this module serves headless gateway
 * and migrate paths without requiring Electron.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  makeVaultRef,
  isVaultRef,
  VAULT_REF_PREFIX,
} from "@grokdesk/shared";

export interface CredentialVault {
  put(secret: string, meta?: { label?: string }): string;
  get(ref: string): string | null;
  delete(ref: string): boolean;
  /** True when secrets are encrypted at rest (file vault) or OS-hardened. */
  isHardened(): boolean;
}

function parseRef(ref: string): string | null {
  if (!isVaultRef(ref)) return null;
  const id = ref.slice(VAULT_REF_PREFIX.length);
  // Only UUID-ish ids — refuse path segments that could escape the vault dir.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return null;
  return id;
}

export class MemoryCredentialVault implements CredentialVault {
  private store = new Map<string, string>();

  put(secret: string, _meta?: { label?: string }): string {
    const id = randomUUID();
    this.store.set(id, secret);
    return makeVaultRef(id);
  }

  get(ref: string): string | null {
    const id = parseRef(ref);
    if (!id) return null;
    return this.store.get(id) ?? null;
  }

  delete(ref: string): boolean {
    const id = parseRef(ref);
    if (!id) return false;
    return this.store.delete(id);
  }

  isHardened(): boolean {
    return false;
  }
}

/**
 * Durable AES-256-GCM vault under `dir`.
 * Key file: `.key` (32 bytes, mode 0o600). Secret files: `<id>.bin`.
 */
export class FileCredentialVault implements CredentialVault {
  private key: Buffer;

  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keyPath = path.join(dir, ".key");
    if (fs.existsSync(keyPath)) {
      this.key = fs.readFileSync(keyPath);
      if (this.key.length !== 32) {
        throw new Error("credential vault key must be 32 bytes");
      }
    } else {
      this.key = randomBytes(32);
      fs.writeFileSync(keyPath, this.key, { mode: 0o600 });
      try {
        fs.chmodSync(keyPath, 0o600);
      } catch {
        // best-effort on platforms without chmod
      }
    }
  }

  put(secret: string, _meta?: { label?: string }): string {
    const id = randomUUID();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, tag, enc]);
    const file = path.join(this.dir, `${id}.bin`);
    fs.writeFileSync(file, blob, { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // best-effort
    }
    return makeVaultRef(id);
  }

  get(ref: string): string | null {
    const id = parseRef(ref);
    if (!id) return null;
    const file = path.join(this.dir, `${id}.bin`);
    if (!fs.existsSync(file)) return null;
    try {
      const blob = fs.readFileSync(file);
      if (blob.length < 12 + 16) return null;
      const iv = blob.subarray(0, 12);
      const tag = blob.subarray(12, 28);
      const enc = blob.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(enc),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return null;
    }
  }

  delete(ref: string): boolean {
    const id = parseRef(ref);
    if (!id) return false;
    const file = path.join(this.dir, `${id}.bin`);
    if (!fs.existsSync(file)) return false;
    try {
      fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }

  isHardened(): boolean {
    return true;
  }
}

export function createFileCredentialVault(dataDir: string): FileCredentialVault {
  return new FileCredentialVault(path.join(dataDir, "credential-vault"));
}
