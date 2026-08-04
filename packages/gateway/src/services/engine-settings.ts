import type { AppSettings } from "./settings.js";

/**
 * Whether MCP / skills / engine-mode settings changed enough that the
 * Grok Build engine process config must be rebuilt for new runs.
 */
export function engineSettingsChanged(
  prev: Pick<
    AppSettings,
    "mcpServers" | "skillsPaths" | "preferProviderEngine"
  >,
  next: Pick<
    AppSettings,
    "mcpServers" | "skillsPaths" | "preferProviderEngine"
  >,
): boolean {
  if (prev.preferProviderEngine !== next.preferProviderEngine) return true;
  if (
    JSON.stringify(prev.skillsPaths ?? []) !==
    JSON.stringify(next.skillsPaths ?? [])
  ) {
    return true;
  }
  if (
    JSON.stringify(prev.mcpServers ?? []) !==
    JSON.stringify(next.mcpServers ?? [])
  ) {
    return true;
  }
  return false;
}
