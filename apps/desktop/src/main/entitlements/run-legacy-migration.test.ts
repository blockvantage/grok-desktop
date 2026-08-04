import { verify as cryptoVerify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntitlementClient } from "@grokdesk/entitlement-client";
import {
  ACTIVATE_PREFIX,
  base64urlDecode,
  buildProofSigningMaterial,
} from "@grokdesk/license";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createExchangeLegacyGd2,
  getLastLegacyMigrationStatus,
  runLegacyMigrationAtStartup,
  setLastLegacyMigrationStatusForTests,
} from "./run-legacy-migration.js";
import {
  createSqliteLegacyGatewayPort,
  fingerprintLegacyMaterial,
  type LegacyDetection,
  type LegacyGatewayPort,
  type LegacyLicenseMaterial,
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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const FIXED_NOW = new Date(leaseDoc.fixedClockSeconds * 1000);
const GD1_KEY = "GD1.old-hmac-body.SIG_GD1_LEGACY_TEST";


function vectorDeviceIdentity(): DeviceIdentity {
  const rec: DeviceIdentityRecord = {
    schema: 1,
    deviceId: "dev-wire-test",
    createdAt: "2020-01-01T00:00:00.000Z",
    displayName: "Wire Test",
    publicJwk: {
      kty: "OKP",
      crv: "Ed25519",
      x: leaseDoc.keys.device.publicJwk.x,
    },
    privatePkcs8Base64: leaseDoc.keys.device.privatePkcs8Base64,
  };
  return reconstructDeviceIdentity(rec);
}

function material(key: string): LegacyLicenseMaterial {
  return {
    key,
    licenseId: "lic-wire-1",
    email: null,
    machineId: null,
    activatedAt: null,
    lastVerifiedAt: null,
    graceUntil: null,
    product: null,
    activationSig: null,
  };
}

function makeGatewayPort(detection: LegacyDetection): LegacyGatewayPort {
  let current = detection;
  return {
    extract: () => ({
      detection: current,
      extracted: current.status !== "none",
    }),
    purge: (): PurgeResult => {
      current = { status: "none" };
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

function unusedPublicClient(): EntitlementClient {
  return {
    createActivationChallenge: vi.fn(async () => {
      throw new Error("exchange must not run");
    }),
    exchangeLegacyGd2: vi.fn(async () => {
      throw new Error("exchange must not run");
    }),
  } as unknown as EntitlementClient;
}

describe("createExchangeLegacyGd2", () => {
  it("uses the public challenge and proof-bound exchange without internal auth", async () => {
    const identity = vectorDeviceIdentity();
    const challengeId = "ab24f617-f48f-4fd9-b386-8b8990b70483";
    const nonce = "challenge-nonce";
    const createActivationChallenge = vi.fn(async () => ({
      challengeId,
      nonce,
      expiresAt: "2030-01-01T00:00:00.000Z",
      serverTime: "2029-12-31T23:59:00.000Z",
    }));
    const exchangeLegacyGd2 = vi.fn(async (body) => {
      const { gd2: _gd2, signature, ...payload } = body;
      const material = buildProofSigningMaterial(ACTIVATE_PREFIX, {
        ...payload,
        nonce,
      });
      expect(
        cryptoVerify(
          null,
          material.signingBytes,
          identity.publicKey,
          base64urlDecode(signature),
        ),
      ).toBe(true);
      return {
        gd3: "GD3.exchange-body.SIG",
        lease: "eyJlease.jwt",
        entitlementId: "ent-1",
        activationId: "act-1",
        seatSlot: 1,
        serverTime: "2029-12-31T23:59:01.000Z",
        alreadyExchanged: false,
      };
    });
    const client = {
      createActivationChallenge,
      exchangeLegacyGd2,
    } as unknown as EntitlementClient;
    const { exchange, exchangeEnabled } = createExchangeLegacyGd2({
      client,
      getIdentity: async () => identity,
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "macOS 15.0",
        deskVersion: "1.2.3",
      },
    });
    expect(exchangeEnabled).toBe(true);
    const result = await exchange({
      gd2: "GD2.allowlisted.SIG",
      deviceId: identity.deviceId,
      devicePublicJwk: identity.publicJwk,
    });
    expect(result.gd3).toBe("GD3.exchange-body.SIG");
    expect(createActivationChallenge).toHaveBeenCalledWith({
      deskVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    });
    expect(exchangeLegacyGd2).toHaveBeenCalledWith(
      expect.objectContaining({
        gd2: "GD2.allowlisted.SIG",
        challengeId,
        deviceId: identity.deviceId,
        deskVersion: "1.2.3",
        signature: expect.any(String),
      }),
    );
  });
});

describe("runLegacyMigrationAtStartup", () => {
  let root: string;
  let vault: OsCredentialVault;
  let store: EntitlementStateStore;
  let identity: DeviceIdentity;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gd-run-leg-"));
    vault = createMemoryCredentialVault();
    store = new EntitlementStateStore(defaultEntitlementStatePath(root));
    identity = vectorDeviceIdentity();
    setLastLegacyMigrationStatusForTests(null);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    setLastLegacyMigrationStatusForTests(null);
  });

  it("no legacy data → outcome none; never crashes", async () => {
    const gateway = makeGatewayPort({ status: "none" });
    // Track purge via wrapper
    let purgeCount = 0;
    const port: LegacyGatewayPort = {
      extract: gateway.extract,
      purge: async (opts) => {
        purgeCount += 1;
        return gateway.purge(opts);
      },
    };
    const status = await runLegacyMigrationAtStartup({
      userDataDir: root,
      vault,
      stateStore: store,
      getIdentity: async () => identity,
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      resolveLeasePublicKey: async () => null,
      deskVersion: "1.0.0",
      client: unusedPublicClient(),
      gateway: port,
      now: () => FIXED_NOW,
    });
    expect(status.outcome).toBe("none");
    expect(status.exchangeEnabled).toBe(true);
    expect(purgeCount).toBe(0);
    expect(getLastLegacyMigrationStatus()).toEqual(status);
  });

  it("unsupported GD1 purges without attempting the public exchange", async () => {
    const mat = material(GD1_KEY);
    const detection: LegacyDetection = {
      status: "unsupported",
      scheme: "gd1",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
      reason: "gd1",
      supportUrl: "https://x.ai/grok/desk/license-recovery",
      portalUrl: "https://x.ai/grok/desk/portal",
    };
    let purged = false;
    const port: LegacyGatewayPort = {
      extract: () => ({ detection, extracted: true }),
      purge: () => {
        purged = true;
        return {
          purged: true,
          alreadyClean: false,
          secureDelete: true,
          walCheckpoint: true,
          vacuumed: false,
          fingerprint: detection.fingerprint,
        };
      },
    };
    const log = vi.fn();
    const status = await runLegacyMigrationAtStartup({
      userDataDir: root,
      vault,
      stateStore: store,
      getIdentity: async () => identity,
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      resolveLeasePublicKey: async () => null,
      deskVersion: "1.0.0",
      client: unusedPublicClient(),
      gateway: port,
      log,
      now: () => FIXED_NOW,
    });
    expect(status.outcome).toBe("purged_unsupported");
    expect(status.exchangeEnabled).toBe(true);
    expect(purged).toBe(true);
  });

  it("vault denial fails closed without crashing app", async () => {
    const mat = material("GD2.allowlisted.SIG");
    const detection: LegacyDetection = {
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    };
    const port: LegacyGatewayPort = {
      extract: () => ({ detection, extracted: true }),
      purge: () => {
        throw new Error("purge must not run on vault failure");
      },
    };
    const denyingVault: OsCredentialVault = {
      get: async () => {
        throw new CredentialStoreError();
      },
      set: async () => {
        throw new CredentialStoreError();
      },
      delete: async () => false,
    };
    const status = await runLegacyMigrationAtStartup({
      userDataDir: root,
      vault: denyingVault,
      stateStore: store,
      getIdentity: async () => identity,
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      resolveLeasePublicKey: async () => null,
      deskVersion: "1.0.0",
      gateway: port,
      // exchange would not be reached after vault fail
      exchangeLegacyGd2: async () => {
        throw new Error("exchange must not run");
      },
      now: () => FIXED_NOW,
    });
    expect(status.outcome).toBe("failed");
    expect(status.errorCode).toBe("credential_store_failure");
    expect(
      await denyingVault.get(PRODUCT_KEY_ACCOUNT).catch(() => null),
    ).toBeNull();
  });

  it("reports the durable exchange_started state after a transient failure", async () => {
    const mat = material("GD2.allowlisted.SIG");
    const detection: LegacyDetection = {
      status: "exchangeable",
      scheme: "gd2",
      material: mat,
      fingerprint: fingerprintLegacyMaterial(mat),
    };
    const gateway = makeGatewayPort(detection);
    const status = await runLegacyMigrationAtStartup({
      userDataDir: root,
      vault,
      stateStore: store,
      getIdentity: async () => identity,
      expectedIssuer: leaseDoc.claims.iss,
      expectedAudience: leaseDoc.claims.aud,
      resolveLeasePublicKey: async () => null,
      deskVersion: "1.0.0",
      gateway,
      exchangeLegacyGd2: async () => {
        throw Object.assign(new Error("offline"), {
          code: "service_unavailable",
        });
      },
      now: () => FIXED_NOW,
    });

    expect(status.outcome).toBe("failed");
    expect(status.state).toBe("exchange_started");
    expect(status.errorCode).toBe("service_unavailable");
    expect(status.exchangeEnabled).toBe(true);
  });

  it("createSqliteLegacyGatewayPort opens and closes via inject", async () => {
    const closed: string[] = [];
    const db = { close: () => closed.push("close"), tag: "db" };
    let extractCalls = 0;
    const port = createSqliteLegacyGatewayPort({
      dbPath: "/tmp/unused.sqlite",
      openDatabase: () => db,
      extractLegacyLicense: () => {
        extractCalls += 1;
        return { detection: { status: "none" }, extracted: false };
      },
      purgeLegacyLicense: () => ({
        purged: false,
        alreadyClean: true,
        secureDelete: true,
        walCheckpoint: false,
        vacuumed: false,
        fingerprint: null,
      }),
    });
    const once = await port.extract();
    expect(once.detection.status).toBe("none");
    expect(extractCalls).toBe(1);
    expect(closed).toEqual(["close"]);
  });
});
