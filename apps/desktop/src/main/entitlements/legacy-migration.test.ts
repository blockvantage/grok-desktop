import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rfc7638JwkThumbprint } from "@grokdesk/license";
import {
  createLegacyMigrationRunner,
  defaultLegacyMigrationJournalPath,
  fingerprintLegacyMaterial,
  isLegacyExchangeOpen,
  LEGACY_MIGRATION_PORTAL_URL,
  LEGACY_MIGRATION_SUNSET_ISO,
  LEGACY_MIGRATION_SUPPORT_URL,
  readLegacyMigrationJournal,
  type ExchangeLegacyGd2,
  type LegacyDetection,
  type LegacyGatewayPort,
  type LegacyLicenseMaterial,
  type LegacyMigrationDeps,
  type PurgeResult,
} from "./legacy-migration.js";
import {
  reconstructDeviceIdentity,
  type DeviceIdentity,
} from "./device-identity.js";
import {
  createMemoryCredentialVault,
  type OsCredentialVault,
} from "./os-credential-vault.js";
import {
  defaultEntitlementStatePath,
  EntitlementStateStore,
} from "./state-store.js";
import { CredentialStoreError,  PRODUCT_KEY_ACCOUNT, type DeviceIdentityRecord } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(
  __dirname,
  "../../../../../packages/license/testdata/crypto/v1",
);

const leaseDoc = JSON.parse(
  readFileSync(path.join(vectorsDir, "device-leases.json"), "utf8"),
) as {
  fixedClockSeconds: number;
  claims: {
    iss: string;
    aud: string;
    deviceThumbprint: string;
    entitlementId: string;
    activationId: string;
  };
  keys: {
    lease: {
      kid: string;
      publicJwk: { kty: string; crv: string; x: string; kid?: string };
      privatePkcs8Base64: string;
    };
    device: {
      publicJwk: { kty: string; crv: string; x: string };
      privatePkcs8Base64: string;
    };
  };
};

const productDoc = JSON.parse(
  readFileSync(path.join(vectorsDir, "product-keys.json"), "utf8"),
) as {
  cases: Array<{ name: string; input?: { gd3?: string } }>;
};

const VALID_GD3 = productDoc.cases.find((c) => c.name === "valid")!.input!
  .gd3!;

const FIXED_NOW = new Date(leaseDoc.fixedClockSeconds * 1000);
const GD2_KEY = "GD2.allowlisted-purchase-body.SIG_GD2_LEGACY_TEST";
const GD1_KEY = "GD1.old-hmac-body.SIG_GD1_LEGACY_TEST";
const DEV_KEY = "DEV-local-unsigned-key";
const ACT_SIG = "H1.activation-sig-canary-TEST";


function vectorDeviceIdentity(): DeviceIdentity {
  const publicJwk = {
    kty: "OKP" as const,
    crv: "Ed25519" as const,
    x: leaseDoc.keys.device.publicJwk.x,
  };
  const record: DeviceIdentityRecord = {
    schema: 1,
    deviceId: "33333333-3333-4333-8333-333333333333",
    publicJwk,
    privatePkcs8Base64: leaseDoc.keys.device.privatePkcs8Base64,
    createdAt: FIXED_NOW.toISOString(),
    displayName: "Migration Test Device",
  };
  return reconstructDeviceIdentity(record);
}

async function mintLease(overrides: {
  deviceThumbprint?: string;
  exp?: number;
} = {}): Promise<string> {
  const jose = await import("jose");
  const pem =
    "-----BEGIN PRIVATE KEY-----\n" +
    Buffer.from(leaseDoc.keys.lease.privatePkcs8Base64, "base64")
      .toString("base64")
      .match(/.{1,64}/g)!
      .join("\n") +
    "\n-----END PRIVATE KEY-----";
  const key = await jose.importPKCS8(pem, "EdDSA");
  const now = leaseDoc.fixedClockSeconds;
  return new jose.SignJWT({
    entitlementId: leaseDoc.claims.entitlementId,
    activationId: leaseDoc.claims.activationId,
    deviceThumbprint:
      overrides.deviceThumbprint ?? leaseDoc.claims.deviceThumbprint,
    productId: "grok-desk",
    capabilities: ["grok-runtime"],
    seatLimit: 3,
    updatePolicy: "lifetime_stable",
    refreshAfter: now + 86_400,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "grokdesk-lease+jwt",
      kid: leaseDoc.keys.lease.kid,
    })
    .setIssuer(leaseDoc.claims.iss)
    .setAudience(leaseDoc.claims.aud)
    .setIssuedAt(now)
    .setExpirationTime(overrides.exp ?? now + 30 * 86_400)
    .setJti("lease-jti-migration-001")
    .sign(key);
}

function material(key: string): LegacyLicenseMaterial {
  return {
    key,
    licenseId: "lic-mig-001",
    email: null,
    machineId: "m-1",
    activatedAt: FIXED_NOW.toISOString(),
    lastVerifiedAt: FIXED_NOW.toISOString(),
    graceUntil: new Date(FIXED_NOW.getTime() + 7e8).toISOString(),
    product: "grokdesk",
    activationSig: ACT_SIG,
  };
}

function makeGatewayPort(initial: LegacyDetection): LegacyGatewayPort & {
  get detection(): LegacyDetection;
  get purged(): boolean;
  get purgeCount(): number;
  get extractCount(): number;
  preserved: { conversations: string; superGrok: string };
} {
  const state = {
    detection: initial as LegacyDetection,
    purged: false,
    purgeCount: 0,
    extractCount: 0,
    preserved: {
      conversations: "conv-keep",
      superGrok: "sg-token-ref-not-a-key",
    },
  };
  return {
    get detection() {
      return state.detection;
    },
    get purged() {
      return state.purged;
    },
    get purgeCount() {
      return state.purgeCount;
    },
    get extractCount() {
      return state.extractCount;
    },
    preserved: state.preserved,
    extract: () => {
      state.extractCount += 1;
      if (state.purged || state.detection.status === "none") {
        return {
          detection: { status: "none" as const },
          extracted: false,
        };
      }
      return {
        detection: state.detection,
        extracted: true,
      };
    },
    purge: (): PurgeResult => {
      state.purgeCount += 1;
      state.purged = true;
      state.detection = { status: "none" };
      return {
        purged: true,
        alreadyClean: false,
        secureDelete: true,
        walCheckpoint: true,
        vacuumed: true,
        fingerprint: null,
      };
    },
  };
}

describe("legacy migration helpers", () => {
  it("PATH standard journal under userData/entitlements", () => {
    const p = defaultLegacyMigrationJournalPath("/tmp/ud");
    expect(p.replace(/\\/g, "/")).toBe(
      "/tmp/ud/entitlements/legacy-migration-journal.json",
    );
  });

  it("exchange window respects sunset 2026-12-31", () => {
    expect(isLegacyExchangeOpen(new Date("2026-12-31T23:59:59.999Z"))).toBe(
      true,
    );
    expect(isLegacyExchangeOpen(new Date("2027-01-01T00:00:00.000Z"))).toBe(
      false,
    );
    expect(LEGACY_MIGRATION_SUNSET_ISO.startsWith("2026-12-31")).toBe(true);
  });
});

describe("createLegacyMigrationRunner", () => {
  let root: string;
  let vault: OsCredentialVault;
  let store: EntitlementStateStore;
  let identity: DeviceIdentity;
  let lease: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gd-leg-mig-"));
    vault = createMemoryCredentialVault();
    store = new EntitlementStateStore(defaultEntitlementStatePath(root));
    identity = vectorDeviceIdentity();
    lease = await mintLease();
  });

  afterEach(async () => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function baseDeps(
    gateway: LegacyGatewayPort,
    exchange: ExchangeLegacyGd2,
    extra: Partial<LegacyMigrationDeps> = {},
  ): LegacyMigrationDeps {
    return {
      userDataDir: root,
      gateway,
      vault,
      stateStore: store,
      getIdentity: async () => identity,
      exchangeLegacyGd2: exchange,
      leaseVerify: {
        expectedIssuer: leaseDoc.claims.iss,
        expectedAudience: leaseDoc.claims.aud,
        resolveLeasePublicKey: async () =>
          leaseDoc.keys.lease.publicJwk as {
            kty: "OKP";
            crv: "Ed25519";
            x: string;
          },
      },
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "15.0",
        deskVersion: "1.2.3",
      },
      now: () => FIXED_NOW,
      ...extra,
    };
  }

  it("no legacy data → complete noop, no exchange, no journal required", async () => {
    const gateway = makeGatewayPort({ status: "none" });
    const exchange = vi.fn();
    const runner = createLegacyMigrationRunner(baseDeps(gateway, exchange));
    const result = await runner.run();
    expect(result.outcome).toBe("none");
    expect(result.state).toBe("complete");
    expect(exchange).not.toHaveBeenCalled();
    expect(gateway.purgeCount).toBe(0);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
  });

  it("allowlisted GD2 exchange → vault GD3, lease state, purge, journal complete", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const exchange = vi.fn<ExchangeLegacyGd2>(async (payload) => {
      expect(payload.gd2).toBe(GD2_KEY);
      expect(payload.deviceId).toBe(identity.deviceId);
      // Never locally mint GD3 — only server returns it
      return {
        gd3: VALID_GD3,
        lease,
        entitlementId: leaseDoc.claims.entitlementId,
        activationId: leaseDoc.claims.activationId,
        serverTime: FIXED_NOW.toISOString(),
        requestId: "req-mig-1",
      };
    });

    const states: string[] = [];
    const runner = createLegacyMigrationRunner(
      baseDeps(gateway, exchange, {
        hooks: {
          afterState: (s) => {
            states.push(s);
          },
        },
      }),
    );

    const result = await runner.run();
    expect(result.outcome).toBe("migrated");
    expect(result.state).toBe("complete");
    expect(result.entitlementId).toBe(leaseDoc.claims.entitlementId);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(gateway.purgeCount).toBe(1);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);

    const st = await store.read();
    expect(st?.lease).toBe(lease);
    expect(st?.deviceId).toBe(identity.deviceId);
    expect(st?.devicePublicKeyThumbprint).toBe(
      rfc7638JwkThumbprint(identity.publicJwk),
    );

    // Journal never contains secrets
    const journalRaw = fs.readFileSync(runner.journalPath, "utf8");
    expect(journalRaw).not.toContain(GD2_KEY);
    expect(journalRaw).not.toContain(VALID_GD3);
    expect(journalRaw).not.toContain(ACT_SIG);
    expect(journalRaw).not.toContain(lease);
    const journal = readLegacyMigrationJournal(runner.journalPath)!;
    expect(journal.state).toBe("complete");
    expect(journal.outcome).toBe("migrated");
    expect(journal.keyScheme).toBe("gd2");

    // State machine order
    expect(states).toEqual([
      "detected",
      "vault_written",
      "exchange_started",
      "lease_received",
      "legacy_purged",
      "complete",
    ]);

    // Preservation of non-license data through gateway port
    expect(gateway.preserved.conversations).toBe("conv-keep");
    expect(gateway.preserved.superGrok).toBe("sg-token-ref-not-a-key");

    // Idempotent restart
    const again = await runner.run();
    expect(again.outcome).toBe("migrated");
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("unrecognized GD2 (server reject) → purge + support, never activate", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const exchange = vi.fn(async () => {
      const err = new Error("not allowlisted");
      (err as { code?: string }).code = "legacy_key_unsupported";
      throw err;
    });
    const runner = createLegacyMigrationRunner(baseDeps(gateway, exchange));
    const result = await runner.run();
    expect(result.outcome).toBe("purged_unsupported");
    expect(result.supportUrl).toBe(LEGACY_MIGRATION_SUPPORT_URL);
    expect(result.errorCode).toBe("legacy_key_unsupported");
    expect(gateway.purgeCount).toBe(1);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it("non-allowlisted GD2 is purged with its exact recovery code", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const exchange = vi.fn(async () => {
      throw Object.assign(new Error("not allowlisted"), {
        code: "legacy_key_not_allowlisted",
      });
    });
    const runner = createLegacyMigrationRunner(baseDeps(gateway, exchange));

    const result = await runner.run();

    expect(result.outcome).toBe("purged_unsupported");
    expect(result.state).toBe("complete");
    expect(result.errorCode).toBe("legacy_key_not_allowlisted");
    expect(result.portalUrl).toBe(LEGACY_MIGRATION_PORTAL_URL);
    expect(gateway.purgeCount).toBe(1);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
  });

  it("server-closed GD2 exchange is a terminal sunset purge", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const exchange = vi.fn(async () => {
      throw Object.assign(new Error("closed"), {
        code: "legacy_exchange_closed",
      });
    });
    const runner = createLegacyMigrationRunner(baseDeps(gateway, exchange));

    const result = await runner.run();

    expect(result.outcome).toBe("sunset_purge");
    expect(result.state).toBe("complete");
    expect(result.errorCode).toBe("legacy_exchange_closed");
    expect(result.supportUrl).toBe(LEGACY_MIGRATION_SUPPORT_URL);
    expect(gateway.purgeCount).toBe(1);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
  });

  it("seat_limit keeps GD2 recoverable and surfaces the self-service portal", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const exchange = vi.fn(async () => {
      throw Object.assign(new Error("three seats used"), {
        code: "seat_limit",
      });
    });
    const runner = createLegacyMigrationRunner(baseDeps(gateway, exchange));

    const result = await runner.run();

    expect(result.outcome).toBe("failed");
    expect(result.state).toBe("exchange_started");
    expect(result.errorCode).toBe("seat_limit");
    expect(result.portalUrl).toBe(LEGACY_MIGRATION_PORTAL_URL);
    expect(gateway.purgeCount).toBe(0);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(GD2_KEY);
  });

  it("transient exchange failure retains GD2 and the durable recovery state", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const exchange = vi.fn(async () => {
      throw Object.assign(new Error("offline"), {
        code: "service_unavailable",
      });
    });
    const runner = createLegacyMigrationRunner(baseDeps(gateway, exchange));

    const result = await runner.run();

    expect(result.outcome).toBe("failed");
    expect(result.state).toBe("exchange_started");
    expect(result.errorCode).toBe("service_unavailable");
    expect(gateway.purgeCount).toBe(0);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(GD2_KEY);
    expect(runner.readJournal()?.state).toBe("exchange_started");
  });

  it("pending purchase fulfillment stays retryable with its exact stable code", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const exchange = vi.fn(async () => {
      throw Object.assign(new Error("webhook still processing"), {
        code: "fulfillment_pending",
      });
    });
    const runner = createLegacyMigrationRunner(baseDeps(gateway, exchange));

    const result = await runner.run();

    expect(result.outcome).toBe("failed");
    expect(result.state).toBe("exchange_started");
    expect(result.errorCode).toBe("fulfillment_pending");
    expect(gateway.purgeCount).toBe(0);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(GD2_KEY);
  });

  it("GD1 / H1 / dev material → purge + support, exchange never called", async () => {
    for (const [key, scheme] of [
      [GD1_KEY, "gd1"],
      ["H1.only", "h1"],
      [DEV_KEY, "dev"],
    ] as const) {
      const dir = fs.mkdtempSync(path.join(root, "case-"));
      const v = createMemoryCredentialVault();
      const st = new EntitlementStateStore(defaultEntitlementStatePath(dir));
      const mat = material(key);
      const gateway = makeGatewayPort({
        status: "unsupported",
        scheme,
        material: mat,
        fingerprint: fingerprintLegacyMaterial(mat),
        reason: scheme,
        supportUrl: LEGACY_MIGRATION_SUPPORT_URL,
        portalUrl: "https://x.ai/grok/desk/portal",
      });
      const exchange = vi.fn();
      const runner = createLegacyMigrationRunner({
        ...baseDeps(gateway, exchange),
        userDataDir: dir,
        vault: v,
        stateStore: st,
      });
      const result = await runner.run();
      expect(result.outcome).toBe("purged_unsupported");
      expect(result.errorCode).toBe("legacy_key_unsupported");
      expect(exchange).not.toHaveBeenCalled();
      expect(gateway.purgeCount).toBe(1);
      expect(await v.get(PRODUCT_KEY_ACCOUNT)).toBeNull();
    }
  });

  it("vault denial leaves SQLite material and reports credential_store_failure", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const denyingVault: OsCredentialVault = {
      get: async () => {
        throw new CredentialStoreError();
      },
      set: async () => {
        throw new CredentialStoreError();
      },
      delete: async () => false,
    };
    const exchange = vi.fn();
    const runner = createLegacyMigrationRunner({
      ...baseDeps(gateway, exchange),
      vault: denyingVault,
    });
    const result = await runner.run();
    expect(result.outcome).toBe("failed");
    expect(result.errorCode).toBe("credential_store_failure");
    expect(exchange).not.toHaveBeenCalled();
    expect(gateway.purgeCount).toBe(0);
    // Detection still exchangeable (not purged)
    expect(gateway.detection.status).toBe("exchangeable");
  });

  it("crash after vault_written resumes exchange (lost response)", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    let crashOnce = true;
    const exchange = vi.fn<ExchangeLegacyGd2>(async () => ({
      gd3: VALID_GD3,
      lease,
      entitlementId: leaseDoc.claims.entitlementId,
      activationId: leaseDoc.claims.activationId,
      serverTime: FIXED_NOW.toISOString(),
    }));

    const runner1 = createLegacyMigrationRunner(
      baseDeps(gateway, exchange, {
        hooks: {
          afterState: async (s) => {
            if (s === "vault_written" && crashOnce) {
              crashOnce = false;
              throw new Error("simulated crash after vault_written");
            }
          },
        },
      }),
    );
    await expect(runner1.run()).rejects.toThrow(/simulated crash/);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(GD2_KEY);
    expect(exchange).not.toHaveBeenCalled();

    const j = readLegacyMigrationJournal(runner1.journalPath)!;
    expect(j.state).toBe("vault_written");

    // Resume
    const runner2 = createLegacyMigrationRunner(baseDeps(gateway, exchange));
    const result = await runner2.run();
    expect(result.outcome).toBe("migrated");
    expect(result.state).toBe("complete");
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);
    expect(gateway.purgeCount).toBe(1);
  });

  it("crash after lease_received resumes purge only", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    let crashLease = true;
    const exchange = vi.fn<ExchangeLegacyGd2>(async () => ({
      gd3: VALID_GD3,
      lease,
      entitlementId: leaseDoc.claims.entitlementId,
      activationId: leaseDoc.claims.activationId,
      serverTime: FIXED_NOW.toISOString(),
    }));

    const runner1 = createLegacyMigrationRunner(
      baseDeps(gateway, exchange, {
        hooks: {
          afterState: async (s) => {
            if (s === "lease_received" && crashLease) {
              crashLease = false;
              throw new Error("simulated crash after lease_received");
            }
          },
        },
      }),
    );
    await expect(runner1.run()).rejects.toThrow(/lease_received/);
    expect(await vault.get(PRODUCT_KEY_ACCOUNT)).toBe(VALID_GD3);
    expect(await store.read()).not.toBeNull();
    expect(gateway.purgeCount).toBe(0);

    const runner2 = createLegacyMigrationRunner(baseDeps(gateway, exchange));
    const result = await runner2.run();
    expect(result.outcome).toBe("migrated");
    expect(result.state).toBe("complete");
    expect(exchange).toHaveBeenCalledTimes(1); // no re-exchange
    expect(gateway.purgeCount).toBe(1);
  });

  it("expiring path after sunset purges without exchange", async () => {
    const mat = material(GD2_KEY);
    const gateway = makeGatewayPort({
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    });
    const exchange = vi.fn();
    const runner = createLegacyMigrationRunner(
      baseDeps(gateway, exchange, {
        now: () => new Date("2027-01-15T00:00:00.000Z"),
      }),
    );
    const result = await runner.run();
    expect(result.outcome).toBe("sunset_purge");
    expect(result.errorCode).toBe("sunset_closed");
    expect(exchange).not.toHaveBeenCalled();
    expect(gateway.purgeCount).toBe(1);
    expect(result.supportUrl).toBe(LEGACY_MIGRATION_SUPPORT_URL);
  });

  it("journal file rejects secret-bearing content on read", async () => {
    const jp = defaultLegacyMigrationJournalPath(root);
    fs.mkdirSync(path.dirname(jp), { recursive: true });
    fs.writeFileSync(
      jp,
      JSON.stringify({
        schema: 1,
        state: "detected",
        keyScheme: "gd2",
        fingerprint: null,
        outcome: "none",
        entitlementId: null,
        activationId: null,
        supportUrl: null,
        portalUrl: null,
        errorCode: null,
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString(),
        // smuggled secret
        leaked: GD2_KEY,
      }),
    );
    // unknown field
    expect(() => readLegacyMigrationJournal(jp)).toThrow(/unknown journal|secret/i);

    fs.writeFileSync(
      jp,
      JSON.stringify({
        schema: 1,
        state: "detected",
        keyScheme: "gd2",
        fingerprint: null,
        outcome: "none",
        entitlementId: null,
        activationId: null,
        supportUrl: null,
        portalUrl: null,
        errorCode: null,
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString(),
      }).replace("gd2", GD2_KEY),
    );
    expect(() => readLegacyMigrationJournal(jp)).toThrow(/secret/i);
  });
});
