import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MemoryCredentialVault,
  FileCredentialVault,
  createFileCredentialVault,
} from "./credential-vault.js";
import { isVaultRef } from "@grokdesk/shared";

const CANARY = "sk-gw-vault-CANARY-never-in-db-zz99";

describe("gateway credential vault", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-vault-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("memory vault round-trips", () => {
    const v = new MemoryCredentialVault();
    const ref = v.put(CANARY, { label: "t" });
    expect(isVaultRef(ref)).toBe(true);
    expect(v.get(ref)).toBe(CANARY);
    expect(v.delete(ref)).toBe(true);
    expect(v.get(ref)).toBeNull();
  });

  it("rejects path-like vault refs", () => {
    const v = createFileCredentialVault(dir);
    expect(v.get("vault:../escape")).toBeNull();
    expect(v.get("vault:a/b")).toBeNull();
    expect(v.delete("vault:..\\evil")).toBe(false);
  });

  it("file vault encrypts at rest and survives reopen", () => {
    const v1 = createFileCredentialVault(dir);
    const ref = v1.put(CANARY);
    expect(v1.isHardened()).toBe(true);
    expect(v1.get(ref)).toBe(CANARY);

    // Ciphertext files must not contain plaintext canary.
    const vaultDir = path.join(dir, "credential-vault");
    for (const name of fs.readdirSync(vaultDir)) {
      if (!name.endsWith(".bin")) continue;
      const body = fs.readFileSync(path.join(vaultDir, name));
      expect(body.toString("utf8")).not.toContain(CANARY);
    }

    const v2 = new FileCredentialVault(vaultDir);
    expect(v2.get(ref)).toBe(CANARY);
    expect(v2.delete(ref)).toBe(true);
    expect(v2.get(ref)).toBeNull();
  });
});
