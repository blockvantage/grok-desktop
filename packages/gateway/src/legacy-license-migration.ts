/**
 * Narrow gateway subpath for legacy SQLite license migration.
 *
 * Responsibilities (gateway-owned only):
 * - Detect / classify legacy license material in settings
 * - Extract material once for main-process vault + server exchange
 * - Securely purge license fields after main verifies GD3 + lease
 *
 * Never transforms GD2 → GD3 locally. Never activates GD1/H1/dev keys.
 * Conversations, tasks, artifacts, preferences, remote, and SuperGrok auth
 * are left untouched.
 *
 * Journaled orchestration (vault write, exchange, lease) lives in desktop
 * main: `apps/desktop/src/main/entitlements/legacy-migration.ts`.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import type { Db } from "./db.js";
import {
  SettingsService,
  type LegacyActivationState,
} from "./services/settings.js";

/** ISO sunset — after this instant only purge+support; no GD2 exchange. */
export const LEGACY_MIGRATION_SUNSET_ISO = "2026-12-31T23:59:59.999Z";

export const LEGACY_MIGRATION_SUPPORT_URL =
  "https://x.ai/grok/desk/license-recovery" as const;
export const LEGACY_MIGRATION_PORTAL_URL =
  "https://x.ai/grok/desk/portal" as const;

/** Patterns that must not remain in SQLite/WAL after a successful purge. */
export const LICENSE_CANARY_PATTERNS: readonly RegExp[] = [
  /\bGD1\./,
  /\bGD2\./,
  /\bGD3\./,
  /\bH1\./,
  /activationSig/i,
  /"key"\s*:\s*"GD/i,
];

export type LegacyKeyScheme =
  | "none"
  | "gd2"
  | "gd1"
  | "h1"
  | "dev"
  | "unrecognized";

/**
 * In-memory legacy material extracted once for main.
 * Never write this structure to journal, logs, or diagnostics.
 */
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
      /** Safe fingerprint of licenseId (or key) for journal — never the key itself. */
      fingerprint: string;
    }
  | {
      status: "unsupported";
      scheme: Exclude<LegacyKeyScheme, "none" | "gd2">;
      material: LegacyLicenseMaterial;
      fingerprint: string;
      reason: "gd1" | "h1" | "dev" | "unrecognized";
      supportUrl: typeof LEGACY_MIGRATION_SUPPORT_URL;
      portalUrl: typeof LEGACY_MIGRATION_PORTAL_URL;
    };

export type PurgeResult = {
  purged: boolean;
  /** True when license field was already absent. */
  alreadyClean: boolean;
  secureDelete: boolean;
  walCheckpoint: boolean;
  vacuumed: boolean;
  /** Safe fingerprint that was purged, if known. */
  fingerprint: string | null;
};

export type LegacyExtractOnce = {
  detection: LegacyDetection;
  /** True when material was present and returned (caller should treat as single-use). */
  extracted: boolean;
};

const DEV_KEY_RE =
  /^(DEV[-_.]|TEST[-_.]|dev[-_.]|test[-_.]|localhost|sk-dev)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Safe non-reversible fingerprint for journal metadata.
 * Prefer licenseId; fall back to hash of key scheme + length (not key bytes in clear).
 */
export function fingerprintLegacyMaterial(
  material: Pick<LegacyLicenseMaterial, "key" | "licenseId">,
): string {
  const basis =
    material.licenseId && material.licenseId.length > 0
      ? `id:${material.licenseId}`
      : `keymeta:${material.key.slice(0, 4)}:${material.key.length}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

/**
 * Classify a raw license key string (no network).
 */
export function classifyLegacyKey(key: unknown): LegacyKeyScheme {
  if (key == null || typeof key !== "string" || key.trim().length === 0) {
    return "none";
  }
  const k = key.trim();
  if (k.startsWith("GD2.")) return "gd2";
  if (k.startsWith("GD1.")) return "gd1";
  if (k.startsWith("H1.")) return "h1";
  if (DEV_KEY_RE.test(k) || k.includes("unsigned-dev") || k === "development") {
    return "dev";
  }
  return "unrecognized";
}

export function activationStateToMaterial(
  activation: LegacyActivationState,
): LegacyLicenseMaterial {
  return {
    key: typeof activation.key === "string" ? activation.key : "",
    licenseId:
      typeof activation.licenseId === "string" ? activation.licenseId : null,
    email: activation.email ?? null,
    machineId:
      typeof activation.machineId === "string" ? activation.machineId : null,
    activatedAt:
      typeof activation.activatedAt === "string" ? activation.activatedAt : null,
    lastVerifiedAt:
      typeof activation.lastVerifiedAt === "string"
        ? activation.lastVerifiedAt
        : null,
    graceUntil:
      typeof activation.graceUntil === "string" ? activation.graceUntil : null,
    product: typeof activation.product === "string" ? activation.product : null,
    activationSig:
      typeof activation.activationSig === "string"
        ? activation.activationSig
        : null,
  };
}

/**
 * Detect and classify legacy license material from a pre-GD3 settings row.
 */
export function detectLegacyLicense(
  license: LegacyActivationState | null | undefined,
): LegacyDetection {
  if (license == null || !isRecord(license as unknown)) {
    return { status: "none" };
  }
  const material = activationStateToMaterial(license);
  if (!material.key) {
    // Activation row without a key still needs purge (may hold sig/ids).
    if (material.activationSig || material.licenseId) {
      const fingerprint = fingerprintLegacyMaterial({
        key: material.activationSig ?? "empty",
        licenseId: material.licenseId,
      });
      return {
        status: "unsupported",
        scheme: "unrecognized",
        material,
        fingerprint,
        reason: "unrecognized",
        supportUrl: LEGACY_MIGRATION_SUPPORT_URL,
        portalUrl: LEGACY_MIGRATION_PORTAL_URL,
      };
    }
    return { status: "none" };
  }

  const scheme = classifyLegacyKey(material.key);
  const fingerprint = fingerprintLegacyMaterial(material);

  if (scheme === "gd2") {
    return {
      status: "exchangeable",
      scheme: "gd2",
      material,
      fingerprint,
    };
  }

  if (scheme === "none") {
    return { status: "none" };
  }

  const reason =
    scheme === "gd1" || scheme === "h1" || scheme === "dev"
      ? scheme
      : "unrecognized";

  return {
    status: "unsupported",
    scheme,
    material,
    fingerprint,
    reason,
    supportUrl: LEGACY_MIGRATION_SUPPORT_URL,
    portalUrl: LEGACY_MIGRATION_PORTAL_URL,
  };
}

/**
 * Whether exchange is still allowed for GD2 (before sunset).
 */
export function isLegacyExchangeOpen(now: Date = new Date()): boolean {
  return now.getTime() <= Date.parse(LEGACY_MIGRATION_SUNSET_ISO);
}

/**
 * Read settings license and classify. Does not mutate the database.
 */
export function detectLegacyLicenseInDb(db: Db): LegacyDetection {
  const settings = new SettingsService(db);
  return detectLegacyLicense(settings.getAll().license);
}

/**
 * Extract legacy material once for main. Non-destructive — SQLite retains the
 * row until {@link purgeLegacyLicense} after vault reread + lease verify.
 */
export function extractLegacyLicense(db: Db): LegacyExtractOnce {
  const detection = detectLegacyLicenseInDb(db);
  if (detection.status === "none") {
    return { detection, extracted: false };
  }
  return { detection, extracted: true };
}

/**
 * Transactionally clear the settings.license field with secure_delete, then
 * WAL checkpoint/truncate. Vacuum is optional and intended for idle windows.
 *
 * Preserves all non-license settings and every other table.
 */
export function purgeLegacyLicense(
  db: Db,
  options: { vacuum?: boolean } = {},
): PurgeResult {
  const settings = new SettingsService(db);
  const before = detectLegacyLicense(settings.getAll().license);
  const fingerprint =
    before.status === "none" ? null : before.fingerprint;

  if (before.status === "none") {
    // Still harden storage flags so callers can checkpoint after prior partial work.
    try {
      db.pragma("secure_delete = ON");
    } catch {
      /* ignore */
    }
    let walCheckpoint = false;
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      walCheckpoint = true;
    } catch {
      walCheckpoint = false;
    }
    let vacuumed = false;
    if (options.vacuum) {
      try {
        db.exec("VACUUM");
        vacuumed = true;
      } catch {
        vacuumed = false;
      }
    }
    return {
      purged: false,
      alreadyClean: true,
      secureDelete: true,
      walCheckpoint,
      vacuumed,
      fingerprint: null,
    };
  }

  db.pragma("secure_delete = ON");

  const clear = db.transaction(() => {
    settings.setLicense(null);
  });
  clear();

  let walCheckpoint = false;
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    walCheckpoint = true;
  } catch {
    walCheckpoint = false;
  }

  let vacuumed = false;
  if (options.vacuum) {
    try {
      db.exec("VACUUM");
      vacuumed = true;
    } catch {
      vacuumed = false;
    }
  }

  return {
    purged: true,
    alreadyClean: false,
    secureDelete: true,
    walCheckpoint,
    vacuumed,
    fingerprint,
  };
}

/**
 * Open a migration handle for a DB path without starting the full Gateway.
 * Caller owns close().
 */
export function openLegacyMigrationDb(
  dbPath: string,
  open: (path: string) => Db,
): {
  db: Db;
  detect: () => LegacyDetection;
  extract: () => LegacyExtractOnce;
  purge: (opts?: { vacuum?: boolean }) => PurgeResult;
  close: () => void;
} {
  const db = open(dbPath);
  return {
    db,
    detect: () => detectLegacyLicenseInDb(db),
    extract: () => extractLegacyLicense(db),
    purge: (opts) => purgeLegacyLicense(db, opts),
    close: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Scan raw file bytes for license canaries (keys / activationSig markers).
 * Used by tests and post-migration verification.
 */
export function scanBufferForLicenseCanaries(
  buf: Buffer | string,
  label = "buffer",
): string[] {
  const text =
    typeof buf === "string" ? buf : buf.toString("utf8");
  // Also scan latin1 so binary SQLite pages with embedded UTF-8 JSON match.
  const latin1 =
    typeof buf === "string" ? buf : buf.toString("latin1");
  const hits: string[] = [];
  for (const re of LICENSE_CANARY_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text) || re.test(latin1)) {
      hits.push(`${label}:${re.source}`);
    }
  }
  return hits;
}

/**
 * Scan main DB file and optional WAL/SHM siblings for license canaries.
 */
export function scanDbFilesForLicenseCanaries(dbPath: string): string[] {
  const siblings = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  const hits: string[] = [];
  for (const p of siblings) {
    if (!fs.existsSync(p)) continue;
    try {
      const body = fs.readFileSync(p);
      hits.push(...scanBufferForLicenseCanaries(body, p));
    } catch {
      /* unreadable — skip */
    }
  }
  return hits;
}

/**
 * Assert post-success canary: no GD1/GD2/GD3/H1/activationSig in SQLite dump/WAL.
 */
export function assertNoLicenseCanariesInDb(dbPath: string): void {
  const hits = scanDbFilesForLicenseCanaries(dbPath);
  if (hits.length > 0) {
    throw new Error(
      `license canary residual after purge: ${hits.slice(0, 8).join(", ")}`,
    );
  }
}
