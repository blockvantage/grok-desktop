#!/usr/bin/env node
/**
 * Cross-repo Contract Gate C1 drift check (desktop side).
 *
 * Pure digests compare OpenAPI pin, crypto vectors, error registry, and
 * release-manifest vectors. Line endings are normalized (CRLF → LF) only;
 * content is otherwise byte-compared via SHA-256. Logs digests and paths —
 * never contract bearer material.
 *
 * Env / CLI:
 *   LANDING_ROOT — path to grok-landing repo (or entitlement-api root)
 *   argv[2]      — same as LANDING_ROOT when env unset
 *   --dry-run    — resolve paths, print desktop digests, skip landing compare
 *
 * PATH standard (desktop repo root):
 *   packages/shared/src/entitlements/testdata/crypto/v1/*
 *   packages/license/testdata/crypto/v1/*
 *   packages/shared/src/entitlements/openapi-v1.sha256
 *   packages/shared/src/entitlements/errors.ts
 *
 * PATH standard (landing entitlement-api root):
 *   contracts/crypto/v1/*
 *   openapi/entitlement-api.v1.json
 *   src/errors.ts
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP_ROOT = path.resolve(__dirname, "..");

/** Ordered crypto vector basenames (product / activation / lease / release). */
export const VECTOR_FILES = [
  "product-keys.json",
  "activation-challenges.json",
  "device-leases.json",
  "release-manifests.json",
] as const;

/** Crypto cases excluding release-manifests (manifest vectors are separate). */
export const CRYPTO_VECTOR_FILES = [
  "product-keys.json",
  "activation-challenges.json",
  "device-leases.json",
] as const;

export const MANIFEST_VECTOR_FILE = "release-manifests.json" as const;

/** PATH standard contract layout under the desktop monorepo root. */
export const DESKTOP_CONTRACT_PATHS = {
  sharedCryptoVectorsDir:
    "packages/shared/src/entitlements/testdata/crypto/v1",
  licenseCryptoVectorsDir: "packages/license/testdata/crypto/v1",
  openapiPin: "packages/shared/src/entitlements/openapi-v1.sha256",
  errors: "packages/shared/src/entitlements/errors.ts",
} as const;

/** PATH standard under landing `services/entitlement-api` (or api root). */
export const LANDING_CONTRACT_PATHS = {
  cryptoVectorsDir: "contracts/crypto/v1",
  openapi: "openapi/entitlement-api.v1.json",
  errors: "src/errors.ts",
} as const;

export type ContractDigestKey =
  | "openapiSha256"
  | "cryptoVectorsSha256"
  | "errorRegistrySha256"
  | "manifestVectorsSha256";

export const CONTRACT_DIGEST_KEYS: readonly ContractDigestKey[] = [
  "openapiSha256",
  "cryptoVectorsSha256",
  "errorRegistrySha256",
  "manifestVectorsSha256",
] as const;

/** Digest bag for one side of the contract (landing or desktop). */
export type ContractSideDigests = {
  openapiSha256: string;
  cryptoVectorsSha256: string;
  errorRegistrySha256: string;
  manifestVectorsSha256: string;
};

export type CheckContractsResult =
  | { ok: true; differences: [] }
  | { ok: false; differences: ContractDigestKey[] };

export type ContractFileReport = {
  path: string;
  sha256: string;
  present: boolean;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Normalize line endings only (CRLF/CR → LF). No other transforms. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** SHA-256 hex of utf8 bytes after line-ending normalization. */
export function sha256NormalizedText(text: string): string {
  return createHash("sha256")
    .update(normalizeLineEndings(text), "utf8")
    .digest("hex");
}

/** SHA-256 hex of raw file bytes (no text transform). */
export function sha256Bytes(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Composite digest for a set of named payloads.
 * Each entry is `name\\0sha256\\n` sorted by name so order of input is irrelevant.
 */
export function compositeSha256(
  parts: ReadonlyArray<{ name: string; sha256: string }>,
): string {
  const lines = [...parts]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name}\0${p.sha256}`)
    .join("\n");
  return sha256NormalizedText(lines);
}

/**
 * Pure contract comparison. Compares digest fields only — no I/O.
 * Returns sorted difference keys when sides diverge.
 */
export function checkContracts(input: {
  landing: ContractSideDigests;
  desktop: ContractSideDigests;
}): CheckContractsResult {
  const differences: ContractDigestKey[] = [];
  for (const key of CONTRACT_DIGEST_KEYS) {
    if (input.landing[key] !== input.desktop[key]) {
      differences.push(key);
    }
  }
  if (differences.length === 0) {
    return { ok: true, differences: [] };
  }
  return { ok: false, differences };
}

/**
 * Build digests from in-memory contract materials (tests / dry fixtures).
 * `openapi` may be either the OpenAPI document body or a 64-char pin hex.
 * `errorRegistrySource` is TypeScript exporting STABLE_ERROR_CODES.
 * Vector maps are basename → file body string.
 */
export function digestsFromMaterials(materials: {
  openapi: string;
  errorRegistrySource: string;
  cryptoVectors: Record<string, string>;
  manifestVector: string;
}): ContractSideDigests {
  const openapiTrim = materials.openapi.trim();
  const openapiSha256 = /^[0-9a-f]{64}$/i.test(openapiTrim)
    ? openapiTrim.toLowerCase()
    : sha256NormalizedText(materials.openapi);

  const cryptoParts = CRYPTO_VECTOR_FILES.map((name) => {
    const body = materials.cryptoVectors[name];
    if (body === undefined) {
      throw new Error(`Missing crypto vector material: ${name}`);
    }
    return { name, sha256: sha256NormalizedText(body) };
  });

  const codes = extractStableErrorCodes(materials.errorRegistrySource);
  const errorRegistrySha256 = sha256NormalizedText(codes.join("\n") + "\n");

  return {
    openapiSha256,
    cryptoVectorsSha256: compositeSha256(cryptoParts),
    errorRegistrySha256,
    manifestVectorsSha256: sha256NormalizedText(materials.manifestVector),
  };
}

export function extractStableErrorCodes(source: string): string[] {
  const match = source.match(
    /export const STABLE_ERROR_CODES\s*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  if (!match) {
    throw new Error("Could not parse STABLE_ERROR_CODES array");
  }
  const body = match[1]!;
  return [...body.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!);
}

// ---------------------------------------------------------------------------
// Filesystem loaders (PATH standard)
// ---------------------------------------------------------------------------

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function sha256FileNormalized(filePath: string): string {
  return sha256NormalizedText(readText(filePath));
}

export function resolveLandingRoot(
  explicit?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromArg = explicit?.trim();
  if (fromArg) return path.resolve(fromArg);
  if (env.LANDING_ROOT?.trim()) {
    return path.resolve(env.LANDING_ROOT.trim());
  }
  // Prefer sibling checkout, then monorepo-adjacent worktrees used locally.
  const candidates = [
    path.resolve(DESKTOP_ROOT, "../grok-landing"),
    path.resolve(DESKTOP_ROOT, "../../grok-landing"),
    path.resolve(
      DESKTOP_ROOT,
      "../../grok-landing/.worktrees/commerce-runtime-rollout",
    ),
    path.resolve(
      DESKTOP_ROOT,
      "../../grok-landing/.worktrees/entitlement-service",
    ),
  ];
  for (const c of candidates) {
    if (
      existsSync(path.join(c, "services/entitlement-api")) ||
      existsSync(path.join(c, "contracts/crypto/v1/product-keys.json"))
    ) {
      return c;
    }
  }
  return candidates[0]!;
}

export function landingEntitlementApi(landingRoot: string): string {
  const candidates = [
    path.join(landingRoot, "services/entitlement-api"),
    landingRoot,
  ];
  for (const c of candidates) {
    if (
      existsSync(
        path.join(c, LANDING_CONTRACT_PATHS.cryptoVectorsDir, "product-keys.json"),
      ) ||
      existsSync(path.join(c, LANDING_CONTRACT_PATHS.openapi))
    ) {
      return c;
    }
  }
  return path.join(landingRoot, "services/entitlement-api");
}

export function loadDesktopDigests(
  desktopRoot: string = DESKTOP_ROOT,
): {
  digests: ContractSideDigests;
  reports: ContractFileReport[];
  errorCodes: string[];
} {
  const reports: ContractFileReport[] = [];
  const sharedDir = path.join(
    desktopRoot,
    DESKTOP_CONTRACT_PATHS.sharedCryptoVectorsDir,
  );
  const licenseDir = path.join(
    desktopRoot,
    DESKTOP_CONTRACT_PATHS.licenseCryptoVectorsDir,
  );
  const openapiPinPath = path.join(
    desktopRoot,
    DESKTOP_CONTRACT_PATHS.openapiPin,
  );
  const errorsPath = path.join(desktopRoot, DESKTOP_CONTRACT_PATHS.errors);

  // Internal copies must match; prefer shared as canonical for digests.
  const cryptoParts: Array<{ name: string; sha256: string }> = [];
  for (const name of CRYPTO_VECTOR_FILES) {
    const sharedPath = path.join(sharedDir, name);
    const licensePath = path.join(licenseDir, name);
    if (!existsSync(sharedPath)) {
      reports.push({ path: sharedPath, sha256: "", present: false });
      throw new Error(`Desktop vector missing: ${sharedPath}`);
    }
    const sharedHash = sha256FileNormalized(sharedPath);
    reports.push({ path: sharedPath, sha256: sharedHash, present: true });
    if (existsSync(licensePath)) {
      const licenseHash = sha256FileNormalized(licensePath);
      reports.push({ path: licensePath, sha256: licenseHash, present: true });
      if (licenseHash !== sharedHash) {
        throw new Error(
          `Desktop internal vector drift ${name}\n  shared:  ${sharedHash}\n  license: ${licenseHash}`,
        );
      }
    } else {
      reports.push({ path: licensePath, sha256: "", present: false });
      throw new Error(`Desktop vector missing: ${licensePath}`);
    }
    cryptoParts.push({ name, sha256: sharedHash });
  }

  const manifestShared = path.join(sharedDir, MANIFEST_VECTOR_FILE);
  const manifestLicense = path.join(licenseDir, MANIFEST_VECTOR_FILE);
  if (!existsSync(manifestShared)) {
    throw new Error(`Desktop manifest vector missing: ${manifestShared}`);
  }
  const manifestHash = sha256FileNormalized(manifestShared);
  reports.push({ path: manifestShared, sha256: manifestHash, present: true });
  if (existsSync(manifestLicense)) {
    const licHash = sha256FileNormalized(manifestLicense);
    reports.push({ path: manifestLicense, sha256: licHash, present: true });
    if (licHash !== manifestHash) {
      throw new Error(
        `Desktop internal manifest drift\n  shared:  ${manifestHash}\n  license: ${licHash}`,
      );
    }
  }

  if (!existsSync(openapiPinPath)) {
    throw new Error(`Missing OpenAPI pin file ${openapiPinPath}`);
  }
  const openapiPin = readText(openapiPinPath).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(openapiPin)) {
    throw new Error(`Invalid OpenAPI pin format in ${openapiPinPath}`);
  }
  reports.push({ path: openapiPinPath, sha256: openapiPin, present: true });

  if (!existsSync(errorsPath)) {
    throw new Error(`Missing desktop errors registry ${errorsPath}`);
  }
  const errorCodes = extractStableErrorCodes(readText(errorsPath));
  const errorRegistrySha256 = sha256NormalizedText(errorCodes.join("\n") + "\n");
  reports.push({
    path: errorsPath,
    sha256: errorRegistrySha256,
    present: true,
  });

  return {
    digests: {
      openapiSha256: openapiPin,
      cryptoVectorsSha256: compositeSha256(cryptoParts),
      errorRegistrySha256,
      manifestVectorsSha256: manifestHash,
    },
    reports,
    errorCodes,
  };
}

export function loadLandingDigests(apiRoot: string): {
  digests: ContractSideDigests;
  reports: ContractFileReport[];
  errorCodes: string[];
  perFile: Record<string, string>;
} {
  const reports: ContractFileReport[] = [];
  const vectorsDir = path.join(apiRoot, LANDING_CONTRACT_PATHS.cryptoVectorsDir);
  const openapiPath = path.join(apiRoot, LANDING_CONTRACT_PATHS.openapi);
  const errorsPath = path.join(apiRoot, LANDING_CONTRACT_PATHS.errors);

  if (!existsSync(vectorsDir)) {
    throw new Error(
      `Landing crypto vectors missing at ${vectorsDir}. Set LANDING_ROOT to the landing worktree.`,
    );
  }

  const perFile: Record<string, string> = {};
  const cryptoParts: Array<{ name: string; sha256: string }> = [];
  for (const name of CRYPTO_VECTOR_FILES) {
    const p = path.join(vectorsDir, name);
    if (!existsSync(p)) {
      reports.push({ path: p, sha256: "", present: false });
      throw new Error(`Landing vector missing: ${p}`);
    }
    const hash = sha256FileNormalized(p);
    perFile[name] = hash;
    cryptoParts.push({ name, sha256: hash });
    reports.push({ path: p, sha256: hash, present: true });
  }

  const manifestPath = path.join(vectorsDir, MANIFEST_VECTOR_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`Landing manifest vector missing: ${manifestPath}`);
  }
  const manifestHash = sha256FileNormalized(manifestPath);
  perFile[MANIFEST_VECTOR_FILE] = manifestHash;
  reports.push({ path: manifestPath, sha256: manifestHash, present: true });

  if (!existsSync(openapiPath)) {
    throw new Error(`Landing OpenAPI missing: ${openapiPath}`);
  }
  // OpenAPI compared as normalized text so pin matches landings with CRLF diffs.
  const openapiSha256 = sha256FileNormalized(openapiPath);
  reports.push({ path: openapiPath, sha256: openapiSha256, present: true });

  if (!existsSync(errorsPath)) {
    throw new Error(`Landing errors registry missing: ${errorsPath}`);
  }
  const errorCodes = extractStableErrorCodes(readText(errorsPath));
  const errorRegistrySha256 = sha256NormalizedText(errorCodes.join("\n") + "\n");
  reports.push({
    path: errorsPath,
    sha256: errorRegistrySha256,
    present: true,
  });

  return {
    digests: {
      openapiSha256,
      cryptoVectorsSha256: compositeSha256(cryptoParts),
      errorRegistrySha256,
      manifestVectorsSha256: manifestHash,
    },
    reports,
    errorCodes,
    perFile,
  };
}

/**
 * Full filesystem drift check. Returns process exit code (0 ok, 1 drift/error).
 */
export function runCrossRepoContractCheck(options: {
  landingRoot?: string | null;
  desktopRoot?: string;
  dryRun?: boolean;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}): number {
  const log = options.log ?? ((msg: string) => console.log(msg));
  const error = options.error ?? ((msg: string) => console.error(msg));
  const desktopRoot = options.desktopRoot ?? DESKTOP_ROOT;

  let failures = 0;
  const fail = (msg: string) => {
    error(`FAIL: ${msg}`);
    failures += 1;
  };

  log(`Desktop root: ${desktopRoot}`);

  let desktop: ReturnType<typeof loadDesktopDigests>;
  try {
    desktop = loadDesktopDigests(desktopRoot);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    return 1;
  }

  log("Desktop digests:");
  for (const key of CONTRACT_DIGEST_KEYS) {
    log(`  ${key}: ${desktop.digests[key]}`);
  }
  log(`  stable error codes: ${desktop.errorCodes.length}`);
  for (const r of desktop.reports) {
    if (r.present) {
      log(`  ${path.relative(desktopRoot, r.path)}: ${r.sha256}`);
    }
  }

  if (options.dryRun) {
    log("\nDry-run: skipped landing compare.");
    return 0;
  }

  const landingRoot = resolveLandingRoot(options.landingRoot);
  const apiRoot = landingEntitlementApi(landingRoot);
  log(`Landing root: ${landingRoot}`);
  log(`Entitlement API: ${apiRoot}`);

  let landing: ReturnType<typeof loadLandingDigests>;
  try {
    landing = loadLandingDigests(apiRoot);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    return 1;
  }

  log("Landing digests:");
  for (const key of CONTRACT_DIGEST_KEYS) {
    log(`  ${key}: ${landing.digests[key]}`);
  }
  log(`  stable error codes: ${landing.errorCodes.length}`);
  for (const r of landing.reports) {
    if (r.present) {
      log(`  ${path.relative(apiRoot, r.path)}: ${r.sha256}`);
    }
  }

  // Per-file vector equality (shared + license vs landing) for actionable paths.
  const sharedDir = path.join(
    desktopRoot,
    DESKTOP_CONTRACT_PATHS.sharedCryptoVectorsDir,
  );
  const licenseDir = path.join(
    desktopRoot,
    DESKTOP_CONTRACT_PATHS.licenseCryptoVectorsDir,
  );
  for (const name of VECTOR_FILES) {
    const landingHash = landing.perFile[name];
    if (!landingHash) continue;
    for (const dir of [sharedDir, licenseDir]) {
      const desktopPath = path.join(dir, name);
      if (!existsSync(desktopPath)) {
        fail(`Desktop vector missing: ${desktopPath}`);
        continue;
      }
      const desktopHash = sha256FileNormalized(desktopPath);
      if (desktopHash !== landingHash) {
        fail(
          `Vector drift ${name} in ${dir}\n  landing: ${landingHash}\n  desktop: ${desktopHash}`,
        );
      } else {
        log(`  OK ${path.relative(desktopRoot, desktopPath)}`);
      }
    }
  }

  if (landing.errorCodes.length < 20) {
    fail(`Landing error codes count ${landing.errorCodes.length} < 20`);
  }
  if (desktop.errorCodes.length < 20) {
    fail(`Desktop error codes count ${desktop.errorCodes.length} < 20`);
  }

  const result = checkContracts({
    landing: landing.digests,
    desktop: desktop.digests,
  });

  if (!result.ok) {
    for (const key of result.differences) {
      fail(
        `${key} drift\n  landing: ${landing.digests[key]}\n  desktop: ${desktop.digests[key]}`,
      );
    }
    if (
      result.differences.includes("errorRegistrySha256") &&
      JSON.stringify(landing.errorCodes) !== JSON.stringify(desktop.errorCodes)
    ) {
      fail(
        `Stable error code list drift\n  landing: ${landing.errorCodes.join(",")}\n  desktop: ${desktop.errorCodes.join(",")}`,
      );
    }
  } else {
    log(`OK digests match (${CONTRACT_DIGEST_KEYS.join(", ")})`);
    log(`OK stable error codes (${desktop.errorCodes.length})`);
  }

  if (failures > 0) {
    error(`\n${failures} contract drift failure(s).`);
    return 1;
  }
  log("\nAll cross-repo contracts match.");
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCli(argv: string[]): {
  landingRoot?: string;
  dryRun: boolean;
} {
  let dryRun = false;
  let landingRoot: string | undefined;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    landingRoot = arg;
  }
  return { landingRoot, dryRun };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const { landingRoot, dryRun } = parseCli(argv);
  return runCrossRepoContractCheck({ landingRoot, dryRun });
}

if (isMainModule()) {
  process.exit(main());
}
