export type {
  EngineAdapter,
  EngineRunOptions,
  EngineStatus,
  NormalizedEngineEvent,
} from "./types.js";
export {
  findGlobalGrokBinary,
  findGrokBinary,
  resolveManagedGrokBinary,
  envWithGrokPath,
  envWithManagedBinary,
  grokInstallDirs,
  probeGrokCli,
  cliVersionAtLeast,
  MIN_MANAGED_CLI_VERSION,
  cliCommand,
  execGrokCli,
  isJsCliBinary,
  type GrokCliProbe,
} from "./discover.js";
export {
  getGrokAuthStatus,
  startGrokLogin,
  shouldSkipBrowserLogin,
  runGrokLogout,
  clearLocalAuthSession,
  completeGrokSignOut,
  readAuthFileMetadata,
  probeModelsViaCli,
  parseModelsCliProbe,
  type GrokAuthStatus,
  type CompleteSignOutResult,
} from "./auth-bridge.js";
export {
  parseStreamingJsonLine,
  parseStreamingJsonOutput,
} from "./events.js";
export {
  GrokBuildEngine,
  createDefaultEngine,
  ManagedRuntimeUnavailableEngine,
  MANAGED_RUNTIME_UNAVAILABLE,
  processEnvForManagedBinary,
  terminateChild,
  withDeskBrowserTaskId,
  seedIsolatedGrokHome,
  buildRunPrompt,
  type CreateDefaultEngineOptions,
  type McpServerConfig,
} from "./session.js";
export {
  findSessionMediaFiles,
  promoteSessionMediaToWorkspace,
  uniqueMediaName,
  type PromotedMediaFile,
  type SessionMediaFile,
} from "./session-media.js";
export { generateGrokTitle, type GenerateTitleOptions } from "./title.js";
export {
  readSuperGrokAccessToken,
  type SuperGrokTokenResult,
} from "./super-grok-token.js";
export {
  BILLING_MANAGE_URL,
  DEFAULT_BILLING_BASE_URL,
  fetchUsageSnapshot,
  parseBillingCreditsResponse,
  warnLevelFromPercent,
  unavailableUsageSnapshot,
  unwrapBillingBody,
  extractUsagePercent,
} from "./billing-client.js";
export {
  parseSttServerMessage,
  createDictationSession,
  createMockSttTransport,
  encodeWavPcm16,
  concatPcm16,
  transcribeAudioFile,
  defaultSttUrl,
  DEFAULT_STT_URL,
  DEFAULT_STT_TIMEOUT_MS,
  type DictationSession,
  type SttTransport,
  type TranscribeResult,
} from "./stt-client.js";

import { resolveManagedGrokBinary } from "./discover.js";
import { getGrokAuthStatus } from "./auth-bridge.js";
import type { EngineStatus } from "./types.js";

export async function getEngineStatus(): Promise<EngineStatus> {
  const status = await getGrokAuthStatus();
  if (!status.binaryPath) return "missing";
  return status.engineStatus;
}

/** Diagnostics alias — not for production engine selection. */
export { findGlobalGrokBinary as discoverGrokBinary } from "./discover.js";
