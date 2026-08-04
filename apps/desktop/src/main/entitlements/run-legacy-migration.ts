/**
 * Startup wire for journaled legacy GD2 migration.
 *
 * Invoked from Electron main **after** entitlement bootstrap (vault ready)
 * and **before** gateway spawn. Keeps index.ts thin.
 *
 * Exchange uses the same public, proof-bound device activation protocol as a
 * normal GD3 activation. Desktop never receives internal service credentials.
 * Vault failures fail closed. Migration errors never crash the app.
 */

import os from "node:os";
import type { EntitlementClient } from "@grokdesk/entitlement-client";
import type { PublicJwk } from "@grokdesk/license";
import {
  buildActivationPayload,
  signActivationProof,
  type PlatformInfo,
} from "./activation-flow.js";
import type { DeviceIdentity } from "./device-identity.js";
import type { OsCredentialVault } from "./os-credential-vault.js";
import type { EntitlementStateStore } from "./state-store.js";
import {
  createLegacyMigrationRunner,
  createSqliteLegacyGatewayPort,
  defaultLegacyMigrationJournalPath,
  LegacyMigrationError,
  readLegacyMigrationJournal,
  type ExchangeLegacyGd2,
  type LegacyGatewayPort,
  type LegacyMigrationResult,
  type MigrationJournalState,
  type MigrationOutcome,
} from "./legacy-migration.js";

// ---------------------------------------------------------------------------
// Public status (safe for logs / diagnostics / future UI — no secrets)
// ---------------------------------------------------------------------------

export type LegacyMigrationUiStatus = {
  outcome: MigrationOutcome | "skipped";
  state: MigrationJournalState | "skipped";
  errorCode: string | null;
  supportUrl: string | null;
  portalUrl: string | null;
  /** True when the public proof-bound exchange client is available. */
  exchangeEnabled: boolean;
};

let lastLegacyMigrationStatus: LegacyMigrationUiStatus | null = null;

/** Last startup migration status (null if not yet run). Safe for diagnostics. */
export function getLastLegacyMigrationStatus(): LegacyMigrationUiStatus | null {
  return lastLegacyMigrationStatus;
}

export function setLastLegacyMigrationStatusForTests(
  status: LegacyMigrationUiStatus | null,
): void {
  lastLegacyMigrationStatus = status;
}

// ---------------------------------------------------------------------------
// Exchange factory
// ---------------------------------------------------------------------------

export type CreateExchangeLegacyGd2Options = {
  client: EntitlementClient;
  getIdentity: () => Promise<DeviceIdentity>;
  platform: PlatformInfo;
};

/**
 * Build the public exchange inject for the migration runner. Each exchange
 * obtains a one-time activation challenge and signs the standard
 * GROKDESK-ACTIVATE-V1 payload with the device identity.
 */
export function createExchangeLegacyGd2(
  options: CreateExchangeLegacyGd2Options,
): { exchange: ExchangeLegacyGd2; exchangeEnabled: boolean } {
  const exchange: ExchangeLegacyGd2 = async ({ gd2 }) => {
    const identity = await options.getIdentity();
    const challenge = await options.client.createActivationChallenge({
      deskVersion: options.platform.deskVersion,
      platform: options.platform.platform,
      arch: options.platform.arch,
    });
    const proof = buildActivationPayload({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      identity,
      platform: options.platform,
    });
    const signature = signActivationProof(identity.privateKey, proof);
    return options.client.exchangeLegacyGd2({
      gd2,
      challengeId: proof.challengeId,
      deviceId: proof.deviceId,
      devicePublicJwk: proof.devicePublicJwk,
      deviceName: proof.deviceName,
      platform: proof.platform,
      arch: proof.arch,
      osVersion: proof.osVersion,
      deskVersion: proof.deskVersion,
      signature,
    });
  };
  return { exchange, exchangeEnabled: true };
}

// ---------------------------------------------------------------------------
// Gateway port (SQLite subpath — never full gateway RPC)
// ---------------------------------------------------------------------------

export type CreateProductionLegacyGatewayPortOptions = {
  /** Absolute path to grokdesk.sqlite (gateway data dir). */
  dbPath: string;
  /**
   * Optional inject for tests. Production loads `@grokdesk/gateway` lazily
   * so unit tests can avoid native better-sqlite3.
   */
  loadGateway?: () => Promise<{
    openDatabase: (path: string) => { close: () => void } & object;
    extractLegacyLicense: (db: unknown) => {
      detection: import("./legacy-migration.js").LegacyDetection;
      extracted: boolean;
    };
    purgeLegacyLicense: (
      db: unknown,
      opts?: { vacuum?: boolean },
    ) => import("./legacy-migration.js").PurgeResult;
    resolveDataPathsFromProcess?: () => { dbPath: string };
  }>;
};

/** Dynamic gateway package load (avoids static resolve in unit tests). */
async function defaultLoadGateway(): Promise<{
  openDatabase: (path: string) => { close: () => void } & object;
  extractLegacyLicense: (db: unknown) => {
    detection: import("./legacy-migration.js").LegacyDetection;
    extracted: boolean;
  };
  purgeLegacyLicense: (
    db: unknown,
    opts?: { vacuum?: boolean },
  ) => import("./legacy-migration.js").PurgeResult;
  resolveDataPathsFromProcess: () => { dbPath: string };
}> {
  // Build specifier at runtime so vitest/vite does not require a built package
  // at collect time; production Electron main resolves workspace dist.
  const specifier = ["@grokdesk", "gateway"].join("/");
  const gw = (await import(/* @vite-ignore */ specifier)) as {
    openDatabase: (path: string) => { close: () => void } & object;
    extractLegacyLicense: (db: unknown) => {
      detection: import("./legacy-migration.js").LegacyDetection;
      extracted: boolean;
    };
    purgeLegacyLicense: (
      db: unknown,
      opts?: { vacuum?: boolean },
    ) => import("./legacy-migration.js").PurgeResult;
    resolveDataPathsFromProcess: () => { dbPath: string };
  };
  return gw;
}

export async function createProductionLegacyGatewayPort(
  options: CreateProductionLegacyGatewayPortOptions,
): Promise<LegacyGatewayPort> {
  const load = options.loadGateway ?? defaultLoadGateway;
  const gw = await load();
  return createSqliteLegacyGatewayPort({
    dbPath: options.dbPath,
    openDatabase: gw.openDatabase,
    extractLegacyLicense: gw.extractLegacyLicense,
    purgeLegacyLicense: gw.purgeLegacyLicense,
  });
}

// ---------------------------------------------------------------------------
// Startup entry
// ---------------------------------------------------------------------------

export type RunLegacyMigrationAtStartupOptions = {
  userDataDir: string;
  vault: OsCredentialVault;
  stateStore: EntitlementStateStore;
  getIdentity: () => Promise<DeviceIdentity>;
  expectedIssuer: string;
  expectedAudience: string;
  /** Resolve lease verification keys (typically well-known JWKS). */
  resolveLeasePublicKey: (
    kid: string,
  ) => Promise<PublicJwk | null> | PublicJwk | null;
  platform?: Partial<PlatformInfo>;
  deskVersion: string;
  now?: () => Date;
  log?: (level: "info" | "warn" | "error", message: string, detail?: string) => void;
  /** Override gateway port (tests). */
  gateway?: LegacyGatewayPort;
  /** Override db path (tests). Default: gateway resolveDataPathsFromProcess().dbPath */
  dbPath?: string;
  /** Override exchange (tests). */
  exchangeLegacyGd2?: ExchangeLegacyGd2;
  /** Pre-resolved public entitlement client. Required outside injected tests. */
  client?: EntitlementClient;
};

function resultToUiStatus(
  result: LegacyMigrationResult,
  exchangeEnabled: boolean,
): LegacyMigrationUiStatus {
  return {
    outcome: result.outcome,
    state: result.state,
    errorCode: result.errorCode,
    supportUrl: result.supportUrl,
    portalUrl: result.portalUrl,
    exchangeEnabled,
  };
}

function skippedStatus(
  exchangeEnabled: boolean,
  errorCode: string | null = null,
): LegacyMigrationUiStatus {
  return {
    outcome: "skipped",
    state: "skipped",
    errorCode,
    supportUrl: null,
    portalUrl: null,
    exchangeEnabled,
  };
}

function resolvePlatform(
  deskVersion: string,
  partial?: Partial<PlatformInfo>,
): PlatformInfo {
  return {
    platform: partial?.platform ?? process.platform,
    arch: partial?.arch ?? process.arch,
    osVersion:
      partial?.osVersion ?? `${process.platform} ${os.release()}`.trim(),
    deskVersion: partial?.deskVersion ?? deskVersion,
  };
}

/**
 * Run journaled legacy migration once at startup.
 * Never throws — failures become {@link LegacyMigrationUiStatus}.
 */
export async function runLegacyMigrationAtStartup(
  options: RunLegacyMigrationAtStartupOptions,
): Promise<LegacyMigrationUiStatus> {
  const log = options.log;
  if (!options.userDataDir) {
    const status = skippedStatus(false, "io");
    lastLegacyMigrationStatus = status;
    log?.("warn", "legacy migration skipped (missing userDataDir)");
    return status;
  }

  const { exchange, exchangeEnabled } = options.exchangeLegacyGd2
    ? {
        exchange: options.exchangeLegacyGd2,
        exchangeEnabled: true,
      }
    : options.client
      ? createExchangeLegacyGd2({
          client: options.client,
          getIdentity: options.getIdentity,
          platform: resolvePlatform(options.deskVersion, options.platform),
        })
      : {
          exchange: async () => {
            throw new LegacyMigrationError(
              "service_unavailable",
              "public_entitlement_client_unavailable",
            );
          },
          exchangeEnabled: false,
        };

  try {
    let gateway = options.gateway;
    if (!gateway) {
      let dbPath = options.dbPath;
      if (!dbPath) {
        const gw = await defaultLoadGateway();
        dbPath = gw.resolveDataPathsFromProcess().dbPath;
      }
      gateway = await createProductionLegacyGatewayPort({ dbPath });
    }

    const runner = createLegacyMigrationRunner({
      userDataDir: options.userDataDir,
      gateway,
      vault: options.vault,
      stateStore: options.stateStore,
      getIdentity: options.getIdentity,
      exchangeLegacyGd2: exchange,
      leaseVerify: {
        expectedIssuer: options.expectedIssuer,
        expectedAudience: options.expectedAudience,
        resolveLeasePublicKey: options.resolveLeasePublicKey,
      },
      platform: resolvePlatform(options.deskVersion, options.platform),
      now: options.now,
    });

    const result = await runner.run();
    const status = resultToUiStatus(result, exchangeEnabled);
    lastLegacyMigrationStatus = status;
    log?.(
      "info",
      "legacy migration finished",
      `outcome=${status.outcome} state=${status.state}${
        status.errorCode ? ` error=${status.errorCode}` : ""
      }`,
    );
    return status;
  } catch (err) {
    // Fail closed for vault / never crash app.
    const code =
      err instanceof LegacyMigrationError
        ? err.code
        : err &&
            typeof err === "object" &&
            "code" in err &&
            typeof (err as { code: unknown }).code === "string"
          ? (err as { code: string }).code
          : "service_unavailable";

    const vaultFail =
      code === "credential_store_failure" || code === "vault_reread_mismatch";

    const journal = (() => {
      try {
        return readLegacyMigrationJournal(
          defaultLegacyMigrationJournalPath(options.userDataDir),
        );
      } catch {
        return null;
      }
    })();
    const status: LegacyMigrationUiStatus = {
      outcome: "failed",
      state: journal?.state ?? "detected",
      errorCode: vaultFail ? "credential_store_failure" : code,
      supportUrl: journal?.supportUrl ?? null,
      portalUrl: journal?.portalUrl ?? null,
      exchangeEnabled,
    };
    lastLegacyMigrationStatus = status;
    log?.(
      vaultFail ? "error" : "warn",
      vaultFail
        ? "legacy migration failed closed (vault); SQLite license left intact"
        : "legacy migration failed (app continues)",
      err instanceof Error ? err.message : String(err),
    );
    return status;
  }
}
