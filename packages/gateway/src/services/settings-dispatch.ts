/**
 * settings.get / settings.set / vault scan+migrate IPC dispatch.
 */

import {
  buildSettingsGetResponse,
  buildSettingsMutateResponse,
  type BundledSkillsInfo,
  type McpServerLike,
} from "./settings-response.js";
import { redactMcpServersForClient } from "@grokdesk/shared";
import {
  buildVaultMigratePayload,
  buildVaultScanPayload,
  type VaultMigratePayload,
  type VaultScanPayload,
} from "./vault-settings-ops.js";
import type { LiteralSecretHit, VaultMigrateReport } from "@grokdesk/shared";

export type SettingsDispatchDeps = {
  getAll: () => Record<string, unknown> & { mcpServers?: McpServerLike[] };
  getBundledSkillsInfo: () => BundledSkillsInfo;
  getEffectiveSkillsPaths: () => string[];
  set: (params: Record<string, unknown>) => Record<string, unknown>;
  applyEngineSettings: (
    prev: Record<string, unknown>,
    next: Record<string, unknown>,
  ) => Promise<boolean>;
  /** Optional vault scan (keys only). */
  scanLiteralSecrets?: () => LiteralSecretHit[];
  vaultStatus?: () => { attached: boolean; hardened: boolean };
  migrateLiteralsToVault?: (opts?: {
    dryRun?: boolean;
  }) => VaultMigrateReport;
};

export const SETTINGS_METHODS = new Set([
  "settings.get",
  "settings.set",
  "settings.vault.scan",
  "settings.vault.migrate",
]);

export function isSettingsMethod(method: string): boolean {
  return SETTINGS_METHODS.has(method);
}

export async function dispatchSettingsMethod(
  method: string,
  params: Record<string, unknown>,
  deps: SettingsDispatchDeps,
): Promise<unknown> {
  switch (method) {
    case "settings.get": {
      const s = deps.getAll();
      const bundled = deps.getBundledSkillsInfo();
      return buildSettingsGetResponse({
        settings: s,
        redactMcpServers: redactMcpServersForClient,
        effectiveSkillsPaths: deps.getEffectiveSkillsPaths(),
        bundled,
      });
    }
    case "settings.set": {
      const prev = deps.getAll();
      const next = deps.set(params);
      const reloaded = await deps.applyEngineSettings(prev, next);
      const bundled = deps.getBundledSkillsInfo();
      // Never return literal MCP secrets on mutate either (vault refs OK).
      const clientSettings = {
        ...next,
        mcpServers: redactMcpServersForClient(
          (next.mcpServers ?? []) as McpServerLike[],
        ),
      };
      return buildSettingsMutateResponse({
        settings: clientSettings,
        effectiveSkillsPaths: deps.getEffectiveSkillsPaths(),
        engineReloaded: reloaded,
        bundledFound: bundled.found,
      });
    }
    case "settings.vault.scan": {
      const hits = deps.scanLiteralSecrets?.() ?? [];
      const status = deps.vaultStatus?.() ?? {
        attached: false,
        hardened: false,
      };
      const payload: VaultScanPayload = buildVaultScanPayload({
        hits,
        vaultAttached: status.attached,
        hardened: status.hardened,
      });
      return payload;
    }
    case "settings.vault.migrate": {
      const dryRun = params.dryRun === true;
      if (!deps.migrateLiteralsToVault) {
        return buildVaultMigratePayload({
          dryRun,
          migrated: [],
          alreadySafe: [],
          hasRemainingLiterals: (deps.scanLiteralSecrets?.() ?? []).length > 0,
        });
      }
      const report = deps.migrateLiteralsToVault({ dryRun });
      const payload: VaultMigratePayload = buildVaultMigratePayload(report);
      return payload;
    }
    default:
      throw new Error(`Unhandled settings method: ${method}`);
  }
}
