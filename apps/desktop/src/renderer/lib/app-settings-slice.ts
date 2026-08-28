/**
 * Slice settings.get payload into renderer appSettings state (Phase 6 extract).
 */
import { preferProviderEngineFromSettings } from "./prefer-provider-engine";

export type AppSettingsSlice = {
  mcpServers: Array<{
    id: string;
    command: string;
    args: string[];
    enabled: boolean;
    env?: Record<string, string>;
  }>;
  skillsPaths: string[];
  effectiveSkillsPaths?: string[];
  /** Opt-in AgentProvider engine path (default false). */
  preferProviderEngine: boolean;
  /** T4: inherit personal Grok plugins/hooks (default false). */
  inheritUserGrok: boolean;
  /** T5: trusted folders for project tools. */
  trustedFolders: string[];
  /** Phase 4.1: Autopilot fail-closed without OS sandbox. */
  requireSandboxForAutopilot: boolean;
};

/**
 * Normalize optional fields from settings.get into App settings state.
 */
export function appSettingsFromSettingsGet(settings: {
  mcpServers?: AppSettingsSlice["mcpServers"];
  skillsPaths?: string[];
  effectiveSkillsPaths?: string[];
  preferProviderEngine?: boolean;
  inheritUserGrok?: boolean;
  trustedFolders?: string[];
  requireSandboxForAutopilot?: boolean;
}): AppSettingsSlice {
  return {
    mcpServers: settings.mcpServers ?? [],
    skillsPaths: settings.skillsPaths ?? [],
    effectiveSkillsPaths: settings.effectiveSkillsPaths ?? [],
    preferProviderEngine: preferProviderEngineFromSettings(
      settings.preferProviderEngine,
    ),
    inheritUserGrok: settings.inheritUserGrok === true,
    trustedFolders: Array.isArray(settings.trustedFolders)
      ? settings.trustedFolders.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        )
      : [],
    requireSandboxForAutopilot: settings.requireSandboxForAutopilot === true,
  };
}
