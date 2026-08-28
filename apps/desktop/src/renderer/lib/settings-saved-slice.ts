/**
 * Pure merge of settings.set response into App appSettings slice (Phase 6).
 */

export type AppSettingsSlice = {
  mcpServers: unknown;
  skillsPaths: string[];
  effectiveSkillsPaths?: string[];
  preferProviderEngine?: boolean;
  inheritUserGrok?: boolean;
  trustedFolders?: string[];
  requireSandboxForAutopilot?: boolean;
};

/**
 * Merge gateway settings.set response with requested next values and prior slice.
 */
export function appSettingsAfterSave(input: {
  prior: AppSettingsSlice;
  next: Partial<AppSettingsSlice> & {
    mcpServers?: AppSettingsSlice["mcpServers"];
    skillsPaths?: string[];
    preferProviderEngine?: boolean;
    inheritUserGrok?: boolean;
    trustedFolders?: string[];
    requireSandboxForAutopilot?: boolean;
  };
  saved: {
    mcpServers?: AppSettingsSlice["mcpServers"];
    skillsPaths?: string[];
    effectiveSkillsPaths?: string[];
    preferProviderEngine?: boolean;
    inheritUserGrok?: boolean;
    trustedFolders?: string[];
    requireSandboxForAutopilot?: boolean;
    engineReloaded?: boolean;
  };
}): {
  slice: AppSettingsSlice;
  toastKey: "settings.savedApplied" | "settings.savedRestart";
} {
  return {
    slice: {
      mcpServers: input.saved.mcpServers ?? input.next.mcpServers ?? input.prior.mcpServers,
      skillsPaths:
        input.saved.skillsPaths ??
        input.next.skillsPaths ??
        input.prior.skillsPaths,
      effectiveSkillsPaths:
        input.saved.effectiveSkillsPaths ?? input.prior.effectiveSkillsPaths,
      preferProviderEngine:
        input.saved.preferProviderEngine ??
        input.next.preferProviderEngine ??
        input.prior.preferProviderEngine ??
        false,
      inheritUserGrok:
        input.saved.inheritUserGrok ??
        input.next.inheritUserGrok ??
        input.prior.inheritUserGrok ??
        false,
      trustedFolders:
        input.saved.trustedFolders ??
        input.next.trustedFolders ??
        input.prior.trustedFolders ??
        [],
      requireSandboxForAutopilot:
        input.saved.requireSandboxForAutopilot ??
        input.next.requireSandboxForAutopilot ??
        input.prior.requireSandboxForAutopilot ??
        false,
    },
    toastKey: input.saved.engineReloaded
      ? "settings.savedApplied"
      : "settings.savedRestart",
  };
}
