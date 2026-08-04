import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SafeStorageCredentialVault,
  createSafeStorageCredentialVault,
} from "./safe-storage-vault.js";
import {
  CredentialStoreError,
  PRODUCT_KEY_ACCOUNT,
  DEVICE_IDENTITY_ACCOUNT,
} from "./types.js";

describe("FileCredentialVault (SafeStorageCredentialVault)", () => {
  let dir: string;
  let filePath: string;
  let keyPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-vault-"));
    filePath = path.join(dir, "entitlement-vault.enc");
    keyPath = path.join(dir, "credential-vault", ".key");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips set/get for both allowed accounts", async () => {
    const vault = new SafeStorageCredentialVault(filePath, keyPath);
    await vault.set(PRODUCT_KEY_ACCOUNT, "GD1.secret");
    await vault.set(DEVICE_IDENTITY_ACCOUNT, "device-123");
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe("GD1.secret");
    expect(await vault.get(DEVICE_IDENTITY_ACCOUNT)).toBe("device-123");
  });

  it("returns null for a missing account and missing file", async () => {
    const vault = new SafeStorageCredentialVault(filePath, keyPath);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
    await vault.set(DEVICE_IDENTITY_ACCOUNT, "d");
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
  });

  it("persists ciphertext to disk, never plaintext; key lives under userData", async () => {
    const vault = new SafeStorageCredentialVault(filePath, keyPath);
    await vault.set(PRODUCT_KEY_ACCOUNT, "GD1.super-secret");
    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).not.toContain("GD1.super-secret");
    const parsed = JSON.parse(raw) as {
      version: number;
      accounts: Record<string, { ct?: string }>;
    };
    expect(parsed.version).toBe(2);
    expect(parsed.accounts[PRODUCT_KEY_ACCOUNT]?.ct).toBeTruthy();
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.statSync(keyPath).size).toBe(32);
  });

  it("deletes and reports prior existence", async () => {
    const vault = new SafeStorageCredentialVault(filePath, keyPath);
    await vault.set(PRODUCT_KEY_ACCOUNT, "x");
    expect(await vault.delete(PRODUCT_KEY_ACCOUNT)).toBe(true);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
    expect(await vault.delete(PRODUCT_KEY_ACCOUNT)).toBe(false);
  });

  it("does not clobber when two accounts are written concurrently", async () => {
    const vault = new SafeStorageCredentialVault(filePath, keyPath);
    await Promise.all([
      vault.set(PRODUCT_KEY_ACCOUNT, "GD1.key"),
      vault.set(DEVICE_IDENTITY_ACCOUNT, "device-abc"),
    ]);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe("GD1.key");
    expect(await vault.get(DEVICE_IDENTITY_ACCOUNT)).toBe("device-abc");
  });

  it("serializes concurrent writes to the same account (last write persists)", async () => {
    const vault = new SafeStorageCredentialVault(filePath, keyPath);
    await Promise.all([
      vault.set(PRODUCT_KEY_ACCOUNT, "first"),
      vault.set(PRODUCT_KEY_ACCOUNT, "second"),
      vault.set(PRODUCT_KEY_ACCOUNT, "third"),
    ]);
    expect(["first", "second", "third"]).toContain(
      await vault.get(PRODUCT_KEY_ACCOUNT),
    );
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      accounts: Record<string, unknown>;
    };
    expect(Object.keys(parsed.accounts)).toEqual([PRODUCT_KEY_ACCOUNT]);
  });

  it("factory creates vault under userData with local key (no keychain)", async () => {
    const vault = createSafeStorageCredentialVault({ userDataDir: dir });
    await vault.set(DEVICE_IDENTITY_ACCOUNT, "id-1");
    expect(await vault.get(DEVICE_IDENTITY_ACCOUNT)).toBe("id-1");
    expect(fs.existsSync(path.join(dir, "entitlement-vault.enc"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "credential-vault", ".key"))).toBe(true);
  });

  it("rejects unsupported accounts", async () => {
    const vault = new SafeStorageCredentialVault(filePath, keyPath);
    await expect(
      vault.set("not-an-account" as typeof PRODUCT_KEY_ACCOUNT, "x"),
    ).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it("treats legacy v1 safeStorage vault as empty (no Keychain read)", async () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        accounts: { [PRODUCT_KEY_ACCOUNT]: "legacy-base64-blob" },
      }),
    );
    const vault = new SafeStorageCredentialVault(filePath, keyPath);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
  });
});
