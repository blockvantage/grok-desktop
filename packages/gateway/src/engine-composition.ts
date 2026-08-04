/**
 * Composition root for the legacy Grok engine adapter (Phase 3 / PORT-01).
 *
 * Concrete `@grokdesk/engine-grok` construction and Grok account helpers live
 * here only. Domain services should depend on `engine-types` + injected
 * EngineAdapter instances, not on Grok constructors.
 *
 * Neutral provider path: see provider-composition.ts (@grokdesk/agent-runtime).
 * Test engines: inject from `@grokdesk/engine-testkit` — never compose here.
 */
export {
  createDefaultEngine,
  ManagedRuntimeUnavailableEngine,
  MANAGED_RUNTIME_UNAVAILABLE,
  generateGrokTitle,
  getGrokAuthStatus,
  startGrokLogin,
  runGrokLogout,
  completeGrokSignOut,
  clearLocalAuthSession,
  resolveManagedGrokBinary,
  findGlobalGrokBinary,
  /** Diagnostics alias only — not for production engine selection. */
  findGrokBinary,
  probeGrokCli,
  envWithGrokPath,
} from "@grokdesk/engine-grok";

export type { EngineAdapter } from "./engine-types.js";
