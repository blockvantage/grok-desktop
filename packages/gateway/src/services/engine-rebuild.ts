/**
 * Engine rebuild orchestration when MCP/skills/provider-mode settings change
 * (Phase 6 extract from Gateway.applyEngineSettings).
 */
import type { AppSettings } from "./settings.js";
import { engineSettingsChanged } from "./engine-settings.js";
import type { EngineAdapter } from "../engine-types.js";

export interface EngineRebuildDeps {
  hasRunner: boolean;
  hasEngineOverride: boolean;
  setMaxConcurrent(n: number): void;
  settingsChanged: typeof engineSettingsChanged;
  createEngine(next: AppSettings): Promise<EngineAdapter>;
  setEngine(engine: EngineAdapter): void;
  /** Re-inject desk MCP planes after rebuild (optional). */
  afterRebuild?(): Promise<void>;
}

/**
 * Update concurrency always. Rebuild the engine when settings that affect
 * process config changed and there is no test override.
 * @returns true if the engine object was replaced.
 */
export async function applyEngineSettingsRebuild(
  prev: AppSettings,
  next: AppSettings,
  deps: EngineRebuildDeps,
): Promise<boolean> {
  if (!deps.hasRunner) return false;
  deps.setMaxConcurrent(next.maxConcurrentTasks);
  if (deps.hasEngineOverride) return false;
  if (!deps.settingsChanged(prev, next)) return false;
  const engine = await deps.createEngine(next);
  deps.setEngine(engine);
  if (deps.afterRebuild) await deps.afterRebuild();
  return true;
}
