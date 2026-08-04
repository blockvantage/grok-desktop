import { describe, it, expect, beforeEach } from "vitest";
import {
  createMemoryCredentialVault,
  type OsCredentialVault,
} from "./os-credential-vault.js";
import {
  CredentialStoreError,
  DEVICE_IDENTITY_ACCOUNT,
  PRODUCT_KEY_ACCOUNT,
} from "./types.js";

describe("createMemoryCredentialVault (test double)", () => {
  let vault: OsCredentialVault;

  beforeEach(() => {
    vault = createMemoryCredentialVault();
  });

  it("sets, gets, and deletes product-key/v1", async () => {
    const secret = "GD3.test.product-key-canary";
    await vault.set(PRODUCT_KEY_ACCOUNT, secret);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(secret);
    expect(await vault.delete(PRODUCT_KEY_ACCOUNT)).toBe(true);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
    expect(await vault.delete(PRODUCT_KEY_ACCOUNT)).toBe(false);
  });

  it("sets, gets, and deletes device-identity/v1", async () => {
    const payload = JSON.stringify({ schema: 1, deviceId: "x" });
    await vault.set(DEVICE_IDENTITY_ACCOUNT, payload);
    expect(await vault.get(DEVICE_IDENTITY_ACCOUNT)).toBe(payload);
    expect(await vault.delete(DEVICE_IDENTITY_ACCOUNT)).toBe(true);
    expect(await vault.get(DEVICE_IDENTITY_ACCOUNT)).toBeNull();
  });

  it("rejects unsupported account names", async () => {
    await expect(
      vault.get("not-a-real-account" as never),
    ).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it("does not import keytar or Keychain APIs", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "os-credential-vault.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/@github\/keytar|require\(["']keytar["']\)/);
    expect(src).not.toMatch(/loadKeytar|KeytarOsCredentialVault|createOsCredentialVault/);
  });
});
