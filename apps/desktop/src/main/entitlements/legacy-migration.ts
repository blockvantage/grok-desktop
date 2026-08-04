/**
 * Journaled desktop legacy GD2 migration orchestrator.
 *
 * Main invokes this **before** normal gateway startup:
 * 1. Detect/extract legacy material once from SQLite (gateway subpath)
 * 2. Move material into the OS credential vault
 * 3. Call **server allowlist exchange only** — never transform GD2 locally
 * 4. After vault reread + lease verify: purge SQLite with secure_delete
 *
 * Journal states (PATH standard under Electron userData):
 *   `<userData>/entitlements/legacy-migration-journal.json`
 *
 *   detected → vault_written → exchange_started → lease_received
 *     → legacy_purged → complete
 *
 * H1/GD1/dev material is purged with recovery/support; never activated.
 * After sunset (2026-12-31) only purge+support — no exchange.
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  extractGd3,
  rfc7638JwkThumbprint,
  type DeviceLeaseClaims,
  type PublicJwk,
} from "@grokdesk/license";
import {
  verifyReturnedLease,
  type LeaseVerifyConfig,
  type PlatformInfo,
} from "./activation-flow.js";
import type { DeviceIdentity } from "./device-identity.js";
import type { OsCredentialVault } from "./os-credential-vault.js";
import {
  type EntitlementStateFile,
  type EntitlementStateStore,
} from "./state-store.js";
import {
  CredentialStoreError,
  isCredentialStoreError,
  PRODUCT_KEY_ACCOUNT,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public constants / types
// ---------------------------------------------------------------------------

export const LEGACY_MIGRATION_JOURNAL_FILENAME =
  "legacy-migration-journal.json" as const;
export const LEGACY_MIGRATION_DIRNAME = "entitlements" as const;

/** Documented sunset — after this, GD2 is purge+support only. */
export const LEGACY_MIGRATION_SUNSET_ISO = "2026-12-31T23:59:59.999Z";

export const LEGACY_MIGRATION_SUPPORT_URL =
  "https://x.ai/grok/desk/license-recovery" as const;
export const LEGACY_MIGRATION_PORTAL_URL =
  "https://x.ai/grok/desk/portal" as const;

export const MIGRATION_JOURNAL_STATES = [
  "detected",
  "vault_written",
  "exchange_started",
  "lease_received",
  "legacy_purged",
  "complete",
] as const;

export type MigrationJournalState = (typeof MIGRATION_JOURNAL_STATES)[number];

export type MigrationKeyScheme =
  | "none"
  | "gd2"
  | "gd1"
  | "h1"
  | "dev"
  | "unrecognized";

export type MigrationOutcome =
  | "none"
  | "migrated"
  | "purged_unsupported"
  | "sunset_purge"
  | "already_complete"
  | "failed";

/** Safe journal — never product keys, activationSig, private keys, or leases. */
export type LegacyMigrationJournal = {
  schema: 1;
  state: MigrationJournalState;
  keyScheme: MigrationKeyScheme;
  fingerprint: string | null;
  outcome: MigrationOutcome;
  entitlementId: string | null;
  activationId: string | null;
  supportUrl: string | null;
  portalUrl: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LegacyLicenseMaterial = {
  key: string;
  licenseId: string | null;
  email: string | null;
  machineId: string | null;
  activatedAt: string | null;
  lastVerifiedAt: string | null;
  graceUntil: string | null;
  product: string | null;
  activationSig: string | null;
};

export type LegacyDetection =
  | { status: "none" }
  | {
      status: "exchangeable";
      scheme: "gd2";
      material: LegacyLicenseMaterial;
      fingerprint: string;
    }
  | {
      status: "unsupported";
      scheme: Exclude<MigrationKeyScheme, "none" | "gd2">;
      material: LegacyLicenseMaterial;
      fingerprint: string;
      reason: "gd1" | "h1" | "dev" | "unrecognized";
      supportUrl: string;
      portalUrl: string;
    };

export type LegacyExtractOnce = {
  detection: LegacyDetection;
  extracted: boolean;
};

export type PurgeResult = {
  purged: boolean;
  alreadyClean: boolean;
  secureDelete: boolean;
  walCheckpoint: boolean;
  vacuumed: boolean;
  fingerprint: string | null;
};

/**
 * Narrow gateway migration port — main never starts full gateway RPC for this.
 * Production wires SQLite helpers from `@grokdesk/gateway`.
 */
export type LegacyGatewayPort = {
  extract: () => LegacyExtractOnce | Promise<LegacyExtractOnce>;
  purge: (opts?: {
    vacuum?: boolean;
  }) => PurgeResult | Promise<PurgeResult>;
};

/** Server allowlist exchange — never performed locally. */
export type ExchangeLegacyGd2Payload = {
  gd2: string;
  deviceId: string;
  devicePublicJwk: PublicJwk;
  deviceName?: string;
  platform?: string;
  arch?: string;
  osVersion?: string;
  deskVersion?: string;
};

export type ExchangeLegacyGd2Result = {
  gd3: string;
  lease: string;
  entitlementId?: string;
  activationId?: string;
  seatSlot?: number;
  serverTime?: string;
  alreadyExchanged?: boolean;
  requestId?: string | null;
};

export type ExchangeLegacyGd2 = (
  payload: ExchangeLegacyGd2Payload,
) => Promise<ExchangeLegacyGd2Result>;

export type LegacyMigrationErrorCode =
  | "legacy_key_unsupported"
  | "legacy_key_not_allowlisted"
  | "legacy_exchange_closed"
  | "seat_limit"
  | "fulfillment_pending"
  | "credential_store_failure"
  | "service_unavailable"
  | "invalid_lease"
  | "vault_reread_mismatch"
  | "sunset_closed"
  | "io";

export class LegacyMigrationError extends Error {
  readonly code: LegacyMigrationErrorCode;

  constructor(code: LegacyMigrationErrorCode, message?: string) {
    super(message ?? code);
    this.name = "LegacyMigrationError";
    this.code = code;
  }
}

export type LegacyMigrationResult = {
  outcome: MigrationOutcome;
  state: MigrationJournalState;
  journal: LegacyMigrationJournal | null;
  supportUrl: string | null;
  portalUrl: string | null;
  errorCode: string | null;
  entitlementId: string | null;
  activationId: string | null;
  claims: DeviceLeaseClaims | null;
};

export type LegacyMigrationDeps = {
  userDataDir: string;
  gateway: LegacyGatewayPort;
  vault: OsCredentialVault;
  stateStore: EntitlementStateStore;
  getIdentity: () => Promise<DeviceIdentity>;
  exchangeLegacyGd2: ExchangeLegacyGd2;
  leaseVerify: LeaseVerifyConfig;
  platform: PlatformInfo;
  now?: () => Date;
  /** Override journal path (tests). */
  journalPath?: string;
  /** When true, vacuum SQLite during purge (idle). Default true. */
  vacuumOnPurge?: boolean;
  /**
   * Crash-injection hooks for durability tests.
   * Invoked after the named state is journaled, before the next side effect.
   */
  hooks?: {
    afterState?: (
      state: MigrationJournalState,
    ) => void | Promise<void>;
  };
};

// ---------------------------------------------------------------------------
// Journal I/O (PATH standard, atomic write)
// ---------------------------------------------------------------------------

export function defaultLegacyMigrationJournalPath(userDataDir: string): string {
  return path.join(
    userDataDir,
    LEGACY_MIGRATION_DIRNAME,
    LEGACY_MIGRATION_JOURNAL_FILENAME,
  );
}

const JOURNAL_ALLOWED_KEYS = new Set([
  "schema",
  "state",
  "keyScheme",
  "fingerprint",
  "outcome",
  "entitlementId",
  "activationId",
  "supportUrl",
  "portalUrl",
  "errorCode",
  "createdAt",
  "updatedAt",
]);

const SECRET_FIELD_RE =
  /GD[123]\.|privatePkcs8|private_key|activationSig|H1\./i;

function isJournalState(v: unknown): v is MigrationJournalState {
  return (
    typeof v === "string" &&
    (MIGRATION_JOURNAL_STATES as readonly string[]).includes(v)
  );
}

export function parseLegacyMigrationJournal(
  raw: string,
): LegacyMigrationJournal {
  if (SECRET_FIELD_RE.test(raw)) {
    throw new LegacyMigrationError(
      "io",
      "journal must not contain secrets",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new LegacyMigrationError("io", "corrupt journal JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LegacyMigrationError("io", "journal must be object");
  }
  const rec = parsed as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (!JOURNAL_ALLOWED_KEYS.has(k)) {
      throw new LegacyMigrationError("io", `unknown journal field: ${k}`);
    }
  }
  if (rec.schema !== 1) {
    throw new LegacyMigrationError("io", "unsupported journal schema");
  }
  if (!isJournalState(rec.state)) {
    throw new LegacyMigrationError("io", "invalid journal state");
  }
  return {
    schema: 1,
    state: rec.state,
    keyScheme: (rec.keyScheme as MigrationKeyScheme) ?? "none",
    fingerprint:
      rec.fingerprint === null || typeof rec.fingerprint === "string"
        ? (rec.fingerprint as string | null)
        : null,
    outcome: (rec.outcome as MigrationOutcome) ?? "none",
    entitlementId:
      rec.entitlementId === null || typeof rec.entitlementId === "string"
        ? (rec.entitlementId as string | null)
        : null,
    activationId:
      rec.activationId === null || typeof rec.activationId === "string"
        ? (rec.activationId as string | null)
        : null,
    supportUrl:
      rec.supportUrl === null || typeof rec.supportUrl === "string"
        ? (rec.supportUrl as string | null)
        : null,
    portalUrl:
      rec.portalUrl === null || typeof rec.portalUrl === "string"
        ? (rec.portalUrl as string | null)
        : null,
    errorCode:
      rec.errorCode === null || typeof rec.errorCode === "string"
        ? (rec.errorCode as string | null)
        : null,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : "",
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : "",
  };
}

function atomicWriteJournal(filePath: string, journal: LegacyMigrationJournal): void {
  const body = `${JSON.stringify(journal)}\n`;
  if (SECRET_FIELD_RE.test(body)) {
    throw new LegacyMigrationError("io", "refusing to write secrets to journal");
  }
  // Validate via parser
  parseLegacyMigrationJournal(body);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* absent */
    }
    fs.renameSync(tmp, filePath);
  }
}

export function readLegacyMigrationJournal(
  filePath: string,
): LegacyMigrationJournal | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return parseLegacyMigrationJournal(raw);
}

function emptyJournal(
  nowIso: string,
  partial: Partial<LegacyMigrationJournal> = {},
): LegacyMigrationJournal {
  return {
    schema: 1,
    state: partial.state ?? "detected",
    keyScheme: partial.keyScheme ?? "none",
    fingerprint: partial.fingerprint ?? null,
    outcome: partial.outcome ?? "none",
    entitlementId: partial.entitlementId ?? null,
    activationId: partial.activationId ?? null,
    supportUrl: partial.supportUrl ?? null,
    portalUrl: partial.portalUrl ?? null,
    errorCode: partial.errorCode ?? null,
    createdAt: partial.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

function resultFromJournal(
  journal: LegacyMigrationJournal | null,
  claims: DeviceLeaseClaims | null = null,
): LegacyMigrationResult {
  if (!journal) {
    return {
      outcome: "none",
      state: "complete",
      journal: null,
      supportUrl: null,
      portalUrl: null,
      errorCode: null,
      entitlementId: null,
      activationId: null,
      claims: null,
    };
  }
  return {
    outcome: journal.outcome,
    state: journal.state,
    journal,
    supportUrl: journal.supportUrl,
    portalUrl: journal.portalUrl,
    errorCode: journal.errorCode,
    entitlementId: journal.entitlementId,
    activationId: journal.activationId,
    claims,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export type LegacyMigrationRunner = {
  /** Absolute journal path (PATH standard). */
  journalPath: string;
  /** Run or resume migration. Idempotent. */
  run: () => Promise<LegacyMigrationResult>;
  /** Read current journal without mutating. */
  readJournal: () => LegacyMigrationJournal | null;
};

/**
 * Create the main-process legacy migration runner.
 * Call `run()` once before normal gateway startup.
 */
export function createLegacyMigrationRunner(
  deps: LegacyMigrationDeps,
): LegacyMigrationRunner {
  if (!deps.userDataDir) {
    throw new TypeError("userDataDir is required");
  }
  const journalPath =
    deps.journalPath ?? defaultLegacyMigrationJournalPath(deps.userDataDir);
  const now = () => deps.now?.() ?? new Date();
  const vacuumOnPurge = deps.vacuumOnPurge !== false;

  async function writeState(
    journal: LegacyMigrationJournal,
    state: MigrationJournalState,
    patch: Partial<LegacyMigrationJournal> = {},
  ): Promise<LegacyMigrationJournal> {
    const next: LegacyMigrationJournal = {
      ...journal,
      ...patch,
      schema: 1,
      state,
      updatedAt: now().toISOString(),
    };
    atomicWriteJournal(journalPath, next);
    if (deps.hooks?.afterState) {
      await deps.hooks.afterState(state);
    }
    return next;
  }

  async function purgeUnsupported(
    journal: LegacyMigrationJournal,
    meta: {
      scheme: MigrationKeyScheme;
      fingerprint: string | null;
      supportUrl?: string | null;
      portalUrl?: string | null;
    },
    outcome: "purged_unsupported" | "sunset_purge",
  ): Promise<LegacyMigrationResult> {
    await deps.gateway.purge({ vacuum: vacuumOnPurge });
    // Best-effort: remove any staged legacy key from vault
    try {
      await deps.vault.delete(PRODUCT_KEY_ACCOUNT);
    } catch {
      /* vault may be empty or denied — purge already done in SQLite */
    }
    const done = await writeState(journal, "complete", {
      keyScheme: meta.scheme,
      fingerprint: meta.fingerprint,
      outcome,
      supportUrl: meta.supportUrl ?? LEGACY_MIGRATION_SUPPORT_URL,
      portalUrl: meta.portalUrl ?? LEGACY_MIGRATION_PORTAL_URL,
      errorCode:
        outcome === "sunset_purge" ? "sunset_closed" : "legacy_key_unsupported",
    });
    return resultFromJournal(done);
  }

  async function handleExchangeFailure(
    journal: LegacyMigrationJournal,
    err: unknown,
  ): Promise<LegacyMigrationResult> {
    if (!(err instanceof LegacyMigrationError)) throw err;

    if (
      err.code === "legacy_key_unsupported" ||
      err.code === "legacy_key_not_allowlisted" ||
      err.code === "legacy_exchange_closed"
    ) {
      await deps.gateway.purge({ vacuum: vacuumOnPurge });
      try {
        await deps.vault.delete(PRODUCT_KEY_ACCOUNT);
      } catch {
        /* terminal server rejection; SQLite purge already completed */
      }
      const closed = err.code === "legacy_exchange_closed";
      const done = await writeState(journal, "complete", {
        outcome: closed ? "sunset_purge" : "purged_unsupported",
        supportUrl: LEGACY_MIGRATION_SUPPORT_URL,
        portalUrl: LEGACY_MIGRATION_PORTAL_URL,
        errorCode: err.code,
      });
      return resultFromJournal(done);
    }

    // Retryable or locally recoverable failures must retain both SQLite and
    // the staged GD2. Persist the actual recovery point and safe error code.
    const failed = await writeState(journal, "exchange_started", {
      outcome: "failed",
      errorCode: err.code,
      supportUrl:
        err.code === "seat_limit" ? LEGACY_MIGRATION_SUPPORT_URL : null,
      portalUrl:
        err.code === "seat_limit" ? LEGACY_MIGRATION_PORTAL_URL : null,
    });
    return resultFromJournal(failed);
  }

  async function exchangeAndInstall(
    journal: LegacyMigrationJournal,
    gd2: string,
  ): Promise<{
    journal: LegacyMigrationJournal;
    claims: DeviceLeaseClaims;
  }> {
    const identity = await deps.getIdentity();
    const thumbprint = rfc7638JwkThumbprint(identity.publicJwk);

    let j = await writeState(journal, "exchange_started");

    let exchanged: ExchangeLegacyGd2Result;
    try {
      exchanged = await deps.exchangeLegacyGd2({
        gd2,
        deviceId: identity.deviceId,
        devicePublicJwk: {
          kty: "OKP",
          crv: "Ed25519",
          x: identity.publicJwk.x,
        },
        deviceName: identity.displayName,
        platform: deps.platform.platform,
        arch: deps.platform.arch,
        osVersion: deps.platform.osVersion,
        deskVersion: deps.platform.deskVersion,
      });
    } catch (err) {
      if (err instanceof LegacyMigrationError) throw err;
      const code =
        err &&
        typeof err === "object" &&
        "code" in err &&
        typeof (err as { code: unknown }).code === "string"
          ? (err as { code: string }).code
          : "service_unavailable";
      if (
        code === "legacy_key_unsupported" ||
        code === "invalid_key_format" ||
        code === "invalid_key_signature"
      ) {
        throw new LegacyMigrationError("legacy_key_unsupported");
      }
      if (code === "legacy_key_not_allowlisted") {
        throw new LegacyMigrationError("legacy_key_not_allowlisted");
      }
      if (code === "legacy_exchange_closed") {
        throw new LegacyMigrationError("legacy_exchange_closed");
      }
      if (code === "seat_limit") {
        throw new LegacyMigrationError("seat_limit");
      }
      if (code === "fulfillment_pending") {
        throw new LegacyMigrationError("fulfillment_pending");
      }
      throw new LegacyMigrationError(
        "service_unavailable",
        code,
      );
    }

    let gd3: string;
    try {
      gd3 = extractGd3(exchanged.gd3);
    } catch {
      throw new LegacyMigrationError(
        "service_unavailable",
        "exchange returned invalid GD3",
      );
    }

    const nowSeconds = Math.floor(
      (Date.parse(exchanged.serverTime ?? "") || now().getTime()) / 1000,
    );
    const verified = await verifyReturnedLease(
      exchanged.lease,
      deps.leaseVerify,
      thumbprint,
      nowSeconds,
    );
    if (!verified.ok) {
      throw new LegacyMigrationError("invalid_lease", verified.code);
    }

    // Replace staged GD2 with GD3 in vault, then write lease state.
    await deps.vault.set(PRODUCT_KEY_ACCOUNT, gd3);
    const reread = await deps.vault.get(PRODUCT_KEY_ACCOUNT);
    if (reread !== gd3) {
      throw new LegacyMigrationError("vault_reread_mismatch");
    }

    const state: EntitlementStateFile = {
      schema: 1,
      deviceId: identity.deviceId,
      devicePublicKeyThumbprint: thumbprint,
      lease: exchanged.lease,
      authoritativeState: "none",
      updatedAt: now().toISOString(),
      requestId: exchanged.requestId ?? null,
    };
    await deps.stateStore.write(state);

    j = await writeState(j, "lease_received", {
      entitlementId: exchanged.entitlementId ?? verified.claims.entitlementId,
      activationId: exchanged.activationId ?? verified.claims.activationId,
      outcome: "migrated",
    });

    return { journal: j, claims: verified.claims };
  }

  async function purgeAfterLease(
    journal: LegacyMigrationJournal,
  ): Promise<LegacyMigrationJournal> {
    await deps.gateway.purge({ vacuum: vacuumOnPurge });
    let j = await writeState(journal, "legacy_purged", {
      outcome: "migrated",
    });
    j = await writeState(j, "complete", {
      outcome: "migrated",
      errorCode: null,
    });
    return j;
  }

  async function resumeFromJournal(
    journal: LegacyMigrationJournal,
  ): Promise<LegacyMigrationResult> {
    if (journal.state === "complete") {
      return resultFromJournal({
        ...journal,
        outcome:
          journal.outcome === "none" ? "already_complete" : journal.outcome,
      });
    }

    if (journal.state === "legacy_purged") {
      const done = await writeState(journal, "complete", {
        outcome: journal.outcome === "none" ? "migrated" : journal.outcome,
      });
      return resultFromJournal(done);
    }

    if (journal.state === "lease_received") {
      const done = await purgeAfterLease(journal);
      return resultFromJournal(done);
    }

    // Need material from vault (preferred) or re-extract from SQLite
    let gd2: string | null = null;
    try {
      gd2 = await deps.vault.get(PRODUCT_KEY_ACCOUNT);
    } catch (err) {
      if (isCredentialStoreError(err)) {
        throw new LegacyMigrationError("credential_store_failure");
      }
      throw err;
    }

    if (!gd2 || !gd2.startsWith("GD2.")) {
      // Vault lost staged GD2 — re-extract from SQLite if still present
      const extracted = await deps.gateway.extract();
      if (
        extracted.detection.status === "exchangeable" &&
        extracted.detection.material.key.startsWith("GD2.")
      ) {
        gd2 = extracted.detection.material.key;
        try {
          await deps.vault.set(PRODUCT_KEY_ACCOUNT, gd2);
        } catch (err) {
          if (isCredentialStoreError(err) || err instanceof CredentialStoreError) {
            throw new LegacyMigrationError("credential_store_failure");
          }
          throw err;
        }
      } else if (extracted.detection.status === "none") {
        // Nothing left to migrate
        const done = await writeState(journal, "complete", {
          outcome: "already_complete",
        });
        return resultFromJournal(done);
      } else if (extracted.detection.status === "unsupported") {
        return purgeUnsupported(
          journal,
          {
            scheme: extracted.detection.scheme,
            fingerprint: extracted.detection.fingerprint,
            supportUrl: extracted.detection.supportUrl,
            portalUrl: extracted.detection.portalUrl,
          },
          "purged_unsupported",
        );
      } else {
        throw new LegacyMigrationError(
          "service_unavailable",
          "cannot resume: no staged GD2",
        );
      }
    }

    // States detected | vault_written | exchange_started resume via exchange
    if (journal.state === "detected") {
      journal = await writeState(journal, "vault_written", {
        keyScheme: "gd2",
      });
    }

    try {
      const { journal: afterEx, claims } = await exchangeAndInstall(
        journal,
        gd2,
      );
      const done = await purgeAfterLease(afterEx);
      return resultFromJournal(done, claims);
    } catch (err) {
      return handleExchangeFailure(journal, err);
    }
  }

  async function runFresh(): Promise<LegacyMigrationResult> {
    const extracted = await deps.gateway.extract();
    const detection = extracted.detection;

    if (detection.status === "none") {
      return resultFromJournal(null);
    }

    const createdAt = now().toISOString();
    let journal = emptyJournal(createdAt, {
      state: "detected",
      keyScheme:
        detection.status === "exchangeable"
          ? "gd2"
          : detection.scheme,
      fingerprint: detection.fingerprint,
      supportUrl:
        detection.status === "unsupported"
          ? detection.supportUrl
          : null,
      portalUrl:
        detection.status === "unsupported" ? detection.portalUrl : null,
    });
    atomicWriteJournal(journalPath, journal);
    if (deps.hooks?.afterState) {
      await deps.hooks.afterState("detected");
    }

    if (detection.status === "unsupported") {
      return purgeUnsupported(
        journal,
        {
          scheme: detection.scheme,
          fingerprint: detection.fingerprint,
          supportUrl: detection.supportUrl,
          portalUrl: detection.portalUrl,
        },
        "purged_unsupported",
      );
    }

    // GD2 path — check sunset
    if (now().getTime() > Date.parse(LEGACY_MIGRATION_SUNSET_ISO)) {
      return purgeUnsupported(
        journal,
        {
          scheme: "gd2",
          fingerprint: detection.fingerprint,
          supportUrl: LEGACY_MIGRATION_SUPPORT_URL,
          portalUrl: LEGACY_MIGRATION_PORTAL_URL,
        },
        "sunset_purge",
      );
    }

    // Stage GD2 into OS vault (never transform locally)
    try {
      await deps.vault.set(PRODUCT_KEY_ACCOUNT, detection.material.key);
      const reread = await deps.vault.get(PRODUCT_KEY_ACCOUNT);
      if (reread !== detection.material.key) {
        throw new LegacyMigrationError("vault_reread_mismatch");
      }
    } catch (err) {
      if (
        isCredentialStoreError(err) ||
        err instanceof CredentialStoreError ||
        (err instanceof LegacyMigrationError &&
          err.code === "credential_store_failure")
      ) {
        const failed = await writeState(journal, "detected", {
          outcome: "failed",
          errorCode: "credential_store_failure",
        });
        return {
          ...resultFromJournal(failed),
          outcome: "failed",
          errorCode: "credential_store_failure",
        };
      }
      if (err instanceof LegacyMigrationError) {
        const failed = await writeState(journal, "detected", {
          outcome: "failed",
          errorCode: err.code,
        });
        return {
          ...resultFromJournal(failed),
          outcome: "failed",
          errorCode: err.code,
        };
      }
      throw err;
    }

    journal = await writeState(journal, "vault_written", {
      keyScheme: "gd2",
      fingerprint: detection.fingerprint,
    });

    try {
      const { journal: afterEx, claims } = await exchangeAndInstall(
        journal,
        detection.material.key,
      );
      const done = await purgeAfterLease(afterEx);
      return resultFromJournal(done, claims);
    } catch (err) {
      return handleExchangeFailure(journal, err);
    }
  }

  return {
    journalPath,
    readJournal: () => {
      try {
        return readLegacyMigrationJournal(journalPath);
      } catch {
        return null;
      }
    },
    run: async () => {
      const existing = (() => {
        try {
          return readLegacyMigrationJournal(journalPath);
        } catch {
          return null;
        }
      })();

      if (existing && existing.state !== "complete") {
        return resumeFromJournal(existing);
      }
      if (existing && existing.state === "complete") {
        // Already finished — still check if SQLite grew new legacy data (rare).
        const extracted = await deps.gateway.extract();
        if (extracted.detection.status === "none") {
          return resultFromJournal({
            ...existing,
            outcome:
              existing.outcome === "none"
                ? "already_complete"
                : existing.outcome,
          });
        }
        // New legacy material after complete — run fresh path with new journal epoch
      }
      return runFresh();
    },
  };
}

/** Hash helper for tests / fingerprints (matches gateway). */
export function fingerprintLegacyMaterial(material: {
  key: string;
  licenseId: string | null;
}): string {
  const basis =
    material.licenseId && material.licenseId.length > 0
      ? `id:${material.licenseId}`
      : `keymeta:${material.key.slice(0, 4)}:${material.key.length}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

export function isLegacyExchangeOpen(now: Date = new Date()): boolean {
  return now.getTime() <= Date.parse(LEGACY_MIGRATION_SUNSET_ISO);
}

/**
 * Build a LegacyGatewayPort from gateway package pure functions + db path.
 * Deferred import keeps unit tests free of native better-sqlite3 when mocked.
 */
export function createSqliteLegacyGatewayPort(options: {
  dbPath: string;
  openDatabase: (path: string) => {
    close: () => void;
  } & object;
  extractLegacyLicense: (db: unknown) => LegacyExtractOnce;
  purgeLegacyLicense: (
    db: unknown,
    opts?: { vacuum?: boolean },
  ) => PurgeResult;
}): LegacyGatewayPort {
  const withDb = <T>(fn: (db: unknown) => T): T => {
    const db = options.openDatabase(options.dbPath);
    try {
      return fn(db);
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  };
  return {
    extract: () => withDb((db) => options.extractLegacyLicense(db)),
    purge: (opts) => withDb((db) => options.purgeLegacyLicense(db, opts)),
  };
}

// Re-export lease verify types consumers may need
export type { LeaseVerifyConfig, PlatformInfo };
