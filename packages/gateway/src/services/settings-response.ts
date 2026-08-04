/**
 * Build settings IPC response payloads with secret-safe MCP redaction (Phase 6).
 */

export type BundledSkillsInfo = {
  found: boolean;
  root: string | null;
  packs: unknown[];
};

export type McpServerLike = {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

/**
 * Shape returned by settings.get: nested settings + back-compat flat fields +
 * derived skill paths (must not round-trip via settings.set).
 */
export function buildSettingsGetResponse(input: {
  settings: Record<string, unknown> & { mcpServers?: McpServerLike[] };
  redactMcpServers: (servers: McpServerLike[]) => McpServerLike[];
  effectiveSkillsPaths: string[];
  bundled: BundledSkillsInfo;
}): Record<string, unknown> {
  const { license: _legacyLicense, ...safeSettings } = input.settings;
  const redacted = {
    ...safeSettings,
    mcpServers: input.redactMcpServers(input.settings.mcpServers ?? []),
  };
  return {
    settings: redacted,
    effectiveSkillsPaths: input.effectiveSkillsPaths,
    bundledSkillsFound: input.bundled.found,
    bundledSkillsRoot: input.bundled.root,
    bundledSkillPacks: input.bundled.packs,
    ...redacted,
  };
}

/**
 * Shape returned by settings.set / connector enable/disable paths.
 */
export function buildSettingsMutateResponse(input: {
  settings: Record<string, unknown>;
  effectiveSkillsPaths: string[];
  engineReloaded: boolean;
  bundledFound?: boolean;
}): Record<string, unknown> {
  const { license: _legacyLicense, ...safeSettings } = input.settings;
  return {
    settings: safeSettings,
    ...safeSettings,
    effectiveSkillsPaths: input.effectiveSkillsPaths,
    engineReloaded: input.engineReloaded,
    ...(input.bundledFound !== undefined
      ? { bundledSkillsFound: input.bundledFound }
      : {}),
  };
}
