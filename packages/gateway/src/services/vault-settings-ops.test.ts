import { describe, it, expect } from "vitest";
import {
  buildVaultScanPayload,
  buildVaultMigratePayload,
} from "./vault-settings-ops.js";

const CANARY = "sk-should-never-appear-in-payload";

describe("vault-settings-ops", () => {
  it("scan payload lists keys only and never embeds secret values", () => {
    const payload = buildVaultScanPayload({
      hits: [
        { serverId: "sec", envKey: "API_KEY", kind: "secret_env_key" },
      ],
      vaultAttached: true,
      hardened: true,
    });
    expect(payload.literalCount).toBe(1);
    expect(payload.hits[0]?.envKey).toBe("API_KEY");
    expect(JSON.stringify(payload)).not.toContain(CANARY);
    expect(payload.vaultAttached).toBe(true);
    expect(payload.hardened).toBe(true);
  });

  it("migrate payload is key-only and reports remaining flags", () => {
    const payload = buildVaultMigratePayload({
      dryRun: true,
      migrated: [
        { serverId: "s", envKey: "TOKEN", kind: "secret_env_key" },
      ],
      alreadySafe: [],
      hasRemainingLiterals: true,
    });
    expect(payload.dryRun).toBe(true);
    expect(payload.migratedCount).toBe(1);
    expect(payload.migrated[0]?.envKey).toBe("TOKEN");
    expect(payload.hasRemainingLiterals).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(CANARY);
  });
});
