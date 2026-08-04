/**
 * Pure orchestration helpers for vault scan/migrate reports (Phase 1 residual).
 * SettingsService owns storage; this shapes IPC-safe payloads (never secret values).
 */
import type { LiteralSecretHit, VaultMigrateReport } from "@grokdesk/shared";

export type VaultScanPayload = {
  literalCount: number;
  /** Keys only — never values. */
  hits: Array<{ serverId: string; envKey: string; kind: string }>;
  vaultAttached: boolean;
  hardened: boolean;
};

export function buildVaultScanPayload(input: {
  hits: LiteralSecretHit[];
  vaultAttached: boolean;
  hardened: boolean;
}): VaultScanPayload {
  return {
    literalCount: input.hits.length,
    hits: input.hits.map((h) => ({
      serverId: h.serverId,
      envKey: h.envKey,
      kind: h.kind,
    })),
    vaultAttached: input.vaultAttached,
    hardened: input.hardened,
  };
}

export type VaultMigratePayload = {
  dryRun: boolean;
  migratedCount: number;
  hasRemainingLiterals: boolean;
  /** Keys only. */
  migrated: Array<{ serverId: string; envKey: string }>;
};

export function buildVaultMigratePayload(
  report: VaultMigrateReport,
): VaultMigratePayload {
  return {
    dryRun: report.dryRun,
    migratedCount: report.migrated.length,
    hasRemainingLiterals: report.hasRemainingLiterals,
    migrated: report.migrated.map((h) => ({
      serverId: h.serverId,
      envKey: h.envKey,
    })),
  };
}
