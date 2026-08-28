import type { Db } from "../db.js";
import {
  enableConnectorPreset,
  disableConnectorPreset,
  enableRecommendedConnectors,
  listConnectorPresets,
  parsePartialAppSettings,
  clampMaxConcurrent,
  mergeDesktopControlSettings,
  DEFAULT_DESKTOP_MACHINE_SETTINGS,
  migrateMcpLiteralSecretsToVaultRefs,
  scanMcpLiteralSecrets,
  resolveMcpVaultRefs,
  mcpServerRowSchema,
  type McpServerRow,
  type DesktopMachineSettings,
  type VaultMigrateReport,
  type LiteralSecretHit,
} from "@grokdesk/shared";
import {
  resolveSkillsPaths,
  hasSkillPacks,
  getBundledSkillsRoot,
  listSkillPackNames,
} from "@grokdesk/shared/node";
import type { CredentialVault } from "./credential-vault.js";

/** Raw pre-GD3 row retained only long enough for the main-process migrator. */
export type LegacyActivationState = {
  key: string;
  licenseId?: string;
  email?: string | null;
  machineId?: string;
  activatedAt?: string;
  lastVerifiedAt?: string;
  graceUntil?: string;
  product?: string;
  activationSig?: string;
  [key: string]: unknown;
};

export interface QuietHours {
  start: string;
  end: string;
  timezone?: string;
}

export interface AppSettings {
  maxConcurrentTasks: number;
  /**
   * Opt-in dual-path: TaskRunner uses AgentProviderEngine instead of engine-grok.
   * Default false — no silent product cutover (see engine-selection.ts).
   */
  preferProviderEngine: boolean;
  quietHours: QuietHours | null;
  defaultModel: string;
  defaultEffort: "fast" | "normal" | "heavy";
  defaultApprovalMode: "strict" | "balanced" | "autopilot";
  mcpServers: Array<{
    id: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    enabled: boolean;
  }>;
  /** User-configured extra skill directories (bundled defaults are merged at resolve time). */
  skillsPaths: string[];
  /** One-time purchase license activation (null if not activated). */
  license: LegacyActivationState | null;
  /** Desktop computer-use machine settings (off by default). */
  desktopControl: DesktopMachineSettings;
  /** First-run onboarding wizard finished (workspace + policy chosen). */
  onboardingCompleted: boolean;
  /**
   * T4: when true, agent runs inherit the user's Grok plugins & hooks.
   * Default false — isolated profile. Env GROKDESK_INHERIT_USER_GROK=1 remains
   * a debug override when settings path is unset.
   */
  inheritUserGrok: boolean;
  /** T5: workspace folders trusted for project tools. */
  trustedFolders: string[];
  /** Phase 3.3: emit a weekly recap inbox item (default on). */
  weeklyRecapEnabled: boolean;
  /**
   * Phase 3.6: Desk-only sign-out. When true, auth.status reports signed-out
   * even if ~/.grok/auth.json still has a SuperGrok session. Never deletes
   * the CLI file; sign-in clears this flag and reuses the session if valid.
   */
  deskSignedOut: boolean;
}

const DEFAULTS: AppSettings = {
  maxConcurrentTasks: 3,
  preferProviderEngine: false,
  quietHours: { start: "22:00", end: "08:00" },
  defaultModel: "grok-4.5",
  defaultEffort: "normal",
  defaultApprovalMode: "balanced",
  mcpServers: [],
  skillsPaths: [],
  license: null,
  desktopControl: { ...DEFAULT_DESKTOP_MACHINE_SETTINGS },
  onboardingCompleted: false,
  inheritUserGrok: false,
  trustedFolders: [],
  weeklyRecapEnabled: true,
  deskSignedOut: false,
};

/** Drop corrupt/hostile MCP rows on settings load (same bounds as settings.set). */
export function sanitizeStoredMcpServers(raw: unknown): AppSettings["mcpServers"] {
  if (!Array.isArray(raw)) return [];
  const out: AppSettings["mcpServers"] = [];
  for (const item of raw) {
    if (out.length >= 64) break;
    const parsed = mcpServerRowSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export class SettingsService {
  private vault: CredentialVault | null = null;

  constructor(private db: Db) {}

  /** Attach vault for migrate-on-write / resolve. Safe to call once after construct. */
  setCredentialVault(vault: CredentialVault | null): void {
    this.vault = vault;
  }

  getCredentialVault(): CredentialVault | null {
    return this.vault;
  }

  vaultStatus(): { attached: boolean; hardened: boolean } {
    return {
      attached: this.vault != null,
      hardened: this.vault?.isHardened() === true,
    };
  }

  getAll(): AppSettings {
    const row = this.db
      .prepare(`SELECT value_json FROM settings WHERE key = 'app'`)
      .get() as { value_json: string } | undefined;
    if (!row) {
      return {
        ...DEFAULTS,
        mcpServers: [],
        skillsPaths: [],
        desktopControl: { ...DEFAULT_DESKTOP_MACHINE_SETTINGS },
      };
    }
    try {
      // Allowlist known keys so retired fields (e.g. simulated-engine flags) never reappear.
      const parsed = JSON.parse(row.value_json) as Record<string, unknown>;
      const rest: Partial<AppSettings> = {
        maxConcurrentTasks:
          typeof parsed.maxConcurrentTasks === "number"
            ? parsed.maxConcurrentTasks
            : undefined,
        preferProviderEngine:
          typeof parsed.preferProviderEngine === "boolean"
            ? parsed.preferProviderEngine
            : undefined,
        quietHours:
          parsed.quietHours === null || typeof parsed.quietHours === "object"
            ? (parsed.quietHours as AppSettings["quietHours"])
            : undefined,
        defaultModel:
          typeof parsed.defaultModel === "string"
            ? parsed.defaultModel
            : undefined,
        defaultEffort:
          parsed.defaultEffort === "fast" ||
          parsed.defaultEffort === "normal" ||
          parsed.defaultEffort === "heavy"
            ? parsed.defaultEffort
            : undefined,
        defaultApprovalMode:
          parsed.defaultApprovalMode === "strict" ||
          parsed.defaultApprovalMode === "balanced" ||
          parsed.defaultApprovalMode === "autopilot"
            ? parsed.defaultApprovalMode
            : undefined,
        mcpServers: Array.isArray(parsed.mcpServers)
          ? sanitizeStoredMcpServers(parsed.mcpServers)
          : undefined,
        skillsPaths: Array.isArray(parsed.skillsPaths)
          ? parsed.skillsPaths
              .filter((p): p is string => typeof p === "string")
              .map((p) => p.trim())
              .filter((p) => p.length > 0 && p.length <= 1024)
              .slice(0, 32)
          : undefined,
        license:
          parsed.license === null || typeof parsed.license === "object"
            ? (parsed.license as AppSettings["license"])
            : undefined,
        desktopControl:
          parsed.desktopControl != null
            ? mergeDesktopControlSettings(parsed.desktopControl)
            : undefined,
        onboardingCompleted:
          typeof parsed.onboardingCompleted === "boolean"
            ? parsed.onboardingCompleted
            : undefined,
        inheritUserGrok:
          typeof parsed.inheritUserGrok === "boolean"
            ? parsed.inheritUserGrok
            : undefined,
        trustedFolders: Array.isArray(parsed.trustedFolders)
          ? parsed.trustedFolders.filter(
              (p): p is string => typeof p === "string" && p.trim().length > 0,
            )
          : undefined,
        weeklyRecapEnabled:
          typeof parsed.weeklyRecapEnabled === "boolean"
            ? parsed.weeklyRecapEnabled
            : undefined,
        deskSignedOut:
          typeof parsed.deskSignedOut === "boolean"
            ? parsed.deskSignedOut
            : undefined,
      };
      return {
        ...DEFAULTS,
        ...rest,
        maxConcurrentTasks: clampMaxConcurrent(
          rest.maxConcurrentTasks,
          DEFAULTS.maxConcurrentTasks,
        ),
        preferProviderEngine:
          typeof rest.preferProviderEngine === "boolean"
            ? rest.preferProviderEngine
            : DEFAULTS.preferProviderEngine,
        mcpServers: rest.mcpServers ?? [],
        skillsPaths: rest.skillsPaths ?? [],
        license: rest.license ?? null,
        desktopControl:
          rest.desktopControl ?? { ...DEFAULT_DESKTOP_MACHINE_SETTINGS },
        inheritUserGrok:
          typeof rest.inheritUserGrok === "boolean"
            ? rest.inheritUserGrok
            : DEFAULTS.inheritUserGrok,
        trustedFolders: rest.trustedFolders ?? DEFAULTS.trustedFolders,
        weeklyRecapEnabled:
          typeof rest.weeklyRecapEnabled === "boolean"
            ? rest.weeklyRecapEnabled
            : DEFAULTS.weeklyRecapEnabled,
        deskSignedOut:
          typeof rest.deskSignedOut === "boolean"
            ? rest.deskSignedOut
            : DEFAULTS.deskSignedOut,
      };
    } catch {
      return {
        ...DEFAULTS,
        mcpServers: [],
        skillsPaths: [],
        desktopControl: { ...DEFAULT_DESKTOP_MACHINE_SETTINGS },
      };
    }
  }

  /**
   * Effective skill directories for the engine: always includes bundled defaults
   * even when the user has not added any custom paths.
   */
  getEffectiveSkillsPaths(): string[] {
    return resolveSkillsPaths(this.getAll().skillsPaths);
  }

  getBundledSkillsInfo(): {
    root: string;
    found: boolean;
    packs: string[];
  } {
    const root = getBundledSkillsRoot();
    const found = hasSkillPacks(root);
    return {
      root,
      found,
      packs: found ? listSkillPackNames(root) : [],
    };
  }

  /**
   * Validated partial update. Rejects unknown keys (including license).
   * The legacy license field is migration-only and is never accepted over IPC.
   */
  set(partial: Record<string, unknown>): AppSettings {
    const parsed = parsePartialAppSettings(partial);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const current = this.getAll();
    const next: AppSettings = {
      ...current,
      ...parsed.value,
      maxConcurrentTasks: clampMaxConcurrent(
        parsed.value.maxConcurrentTasks ?? current.maxConcurrentTasks,
        current.maxConcurrentTasks,
      ),
      preferProviderEngine:
        parsed.value.preferProviderEngine ?? current.preferProviderEngine,
      mcpServers: this.vaultizeMcpServers(
        parsed.value.mcpServers ?? current.mcpServers,
      ),
      skillsPaths: parsed.value.skillsPaths ?? current.skillsPaths,
      desktopControl: parsed.value.desktopControl
        ? mergeDesktopControlSettings({
            ...current.desktopControl,
            ...parsed.value.desktopControl,
          })
        : current.desktopControl,
      inheritUserGrok:
        parsed.value.inheritUserGrok ?? current.inheritUserGrok,
      trustedFolders:
        parsed.value.trustedFolders ?? current.trustedFolders,
      weeklyRecapEnabled:
        parsed.value.weeklyRecapEnabled ?? current.weeklyRecapEnabled,
      deskSignedOut: parsed.value.deskSignedOut ?? current.deskSignedOut,
      // Never accept license from set()
      license: current.license,
    };
    this.persist(next);
    return next;
  }

  private persist(next: AppSettings): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json) VALUES ('app', ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
      )
      .run(JSON.stringify(next));
  }

  /** Scan stored MCP env for literals (keys only — never values). */
  scanLiteralSecrets(): LiteralSecretHit[] {
    return scanMcpLiteralSecrets(this.getAll().mcpServers);
  }

  /**
   * Migrate literal secrets in SQLite → vault refs.
   * This is the safe "purge" of plaintext from settings JSON (not OS keychain wipe).
   * dryRun: report only, no writes.
   */
  migrateLiteralsToVault(opts?: {
    dryRun?: boolean;
  }): VaultMigrateReport {
    if (!this.vault) {
      return {
        migrated: [],
        alreadySafe: [],
        dryRun: opts?.dryRun === true,
        hasRemainingLiterals: this.scanLiteralSecrets().length > 0,
      };
    }
    const current = this.getAll();
    const { servers, report } = migrateMcpLiteralSecretsToVaultRefs(
      current.mcpServers,
      (secret, meta) => this.vault!.put(secret, meta),
      { dryRun: opts?.dryRun },
    );
    if (!opts?.dryRun && report.migrated.length > 0) {
      this.persist({ ...current, mcpServers: servers });
    }
    return report;
  }

  /**
   * Resolve vault refs for engine/ephemeral config only — never for renderer IPC.
   */
  getMcpServersResolved(): AppSettings["mcpServers"] {
    const servers = this.getAll().mcpServers;
    if (!this.vault) return servers;
    return resolveMcpVaultRefs(servers, (ref) => this.vault!.get(ref));
  }

  private vaultizeMcpServers(
    servers: AppSettings["mcpServers"],
  ): AppSettings["mcpServers"] {
    if (!this.vault) return servers;
    const { servers: next } = migrateMcpLiteralSecretsToVaultRefs(
      servers,
      (secret, meta) => this.vault!.put(secret, meta),
    );
    return next;
  }

  getQuietHours(): QuietHours | null {
    return this.getAll().quietHours;
  }

  listConnectorPresets() {
    return listConnectorPresets();
  }

  enableConnectorPreset(
    presetId: string,
    credentials?: Record<string, string>,
  ): AppSettings & {
    missingEnv?: string[];
  } {
    const current = this.getAll();
    const { servers, missingEnv } = enableConnectorPreset(
      current.mcpServers as McpServerRow[],
      presetId,
      process.env,
      credentials,
    );
    const next = {
      ...current,
      mcpServers: this.vaultizeMcpServers(servers),
    };
    this.persist(next);
    return missingEnv.length ? { ...next, missingEnv } : next;
  }

  disableConnectorPreset(presetId: string): AppSettings {
    const current = this.getAll();
    const servers = disableConnectorPreset(
      current.mcpServers as McpServerRow[],
      presetId,
    );
    const next = { ...current, mcpServers: servers };
    this.persist(next);
    return next;
  }

  /** Enable free recommended npx connectors for a seamless first run. */
  enableRecommendedConnectors(): AppSettings {
    const current = this.getAll();
    const servers = enableRecommendedConnectors(
      current.mcpServers as McpServerRow[],
    );
    const next = { ...current, mcpServers: servers };
    this.persist(next);
    return next;
  }

  /** Internal compatibility hook used only to seed or erase pre-GD3 migration data. */
  setLicense(activation: LegacyActivationState | null): AppSettings {
    const current = this.getAll();
    const next = { ...current, license: activation };
    this.persist(next);
    return next;
  }
}
