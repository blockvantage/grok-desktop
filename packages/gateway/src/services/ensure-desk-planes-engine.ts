/**
 * Re-inject desk-browser / desk-desktop MCP into the engine when host planes
 * are present (Phase 6 extract of Gateway.ensureDeskBrowserEngine).
 */
import type { AppSettings } from "./settings.js";
import type { EngineAdapter } from "../engine-types.js";
import {
  buildDeskMcpPrepend,
  detectDeskControlPlanes,
  filterExternalBrowserMcp,
  mergeDeskMcpServers,
  readDeskPlaneEnv,
  type DeskPlaneEnv,
} from "./desk-mcp-planes.js";

export interface EnsureDeskPlanesEngineDeps {
  hasEngineOverride: boolean;
  /** Keep an already-selected AgentProvider/test engine intact. */
  preserveCurrentEngine?: boolean;
  /** Process env (tests inject). */
  env?: NodeJS.ProcessEnv;
  existsSync: (path: string) => boolean;
  getSettings: () => AppSettings;
  getEffectiveSkillsPaths: () => string[];
  createEngine: (input: {
    mcpServers: AppSettings["mcpServers"];
    skillsPaths: string[];
  }) => Promise<EngineAdapter>;
  setEngine: (engine: EngineAdapter) => void;
  /** Optional: read plane env override (tests). */
  readPlane?: (env: NodeJS.ProcessEnv) => DeskPlaneEnv;
}

/**
 * If desk control plane MCP scripts are configured and on disk, rebuild the
 * engine with those servers prepended. Non-fatal on failure.
 * @returns true if a new engine was installed.
 */
export async function ensureDeskPlanesEngine(
  deps: EnsureDeskPlanesEngineDeps,
): Promise<boolean> {
  if (deps.hasEngineOverride || deps.preserveCurrentEngine) return false;
  const env = deps.env ?? process.env;
  const plane = (deps.readPlane ?? readDeskPlaneEnv)(env);
  const detection = detectDeskControlPlanes(plane, deps.existsSync);
  if (!detection.hasBrowser && !detection.hasDesktop) return false;

  try {
    const s = deps.getSettings();
    const prepend = buildDeskMcpPrepend(plane, detection);
    const merged = mergeDeskMcpServers(s.mcpServers ?? [], prepend);
    // Never silently fall back to Chrome/headless MCP when desk-browser is ready.
    const externalAllowed = env.GROKDESK_ALLOW_EXTERNAL_BROWSER === "1";
    const mcpServers = filterExternalBrowserMcp(merged, {
      externalAllowed,
      deskBrowserReady: detection.hasBrowser,
    });
    const engine = await deps.createEngine({
      mcpServers,
      skillsPaths: deps.getEffectiveSkillsPaths(),
    });
    deps.setEngine(engine);
    return true;
  } catch {
    // non-fatal — host bridge / engine override path still works
    return false;
  }
}
