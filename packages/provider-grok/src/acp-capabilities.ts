/**
 * Capability table from ACP `initialize` (Phase 1.1).
 * Help-text probes are pre-spawn sanity only — this is the live source of truth.
 */
import type { AcpInitializeResult } from "./acp-jsonrpc.js";

export type AcpCapabilityTable = {
  agentVersion: string | null;
  sessionCapabilities: {
    close: boolean;
    list: boolean;
    resume: boolean;
    load: boolean;
  };
  hooks: {
    blockingEvents: boolean;
    decisions: boolean;
    stopSignals: boolean;
  } | null;
  toolOverrides: boolean;
  statusLine: boolean;
  availableCommands: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function flag(value: unknown): boolean {
  return value === true;
}

/**
 * Decode initialize result into a stable table. Unknown keys are ignored
 * (forward-compat); missing values are false/null, never assumed true.
 */
export function parseAcpInitializeCapabilities(
  init: AcpInitializeResult | null | undefined,
): AcpCapabilityTable {
  const session = init?.sessionCapabilities ?? {};
  const loadFromCaps = init?.capabilities?.loadSession === true;
  const meta = asRecord(init?._meta);
  const hooksRaw = asRecord(meta?.["x.ai/hooks"]);
  const xaiCaps = asRecord(meta?.["x.ai/capabilities"]);
  const commandsRaw = init?.availableCommands;
  const availableCommands = Array.isArray(commandsRaw)
    ? commandsRaw.filter((c): c is string => typeof c === "string" && Boolean(c.trim()))
    : [];
  const agentVersion =
    (typeof init?.agentVersion === "string" && init.agentVersion.trim()) ||
    (typeof init?.serverInfo?.version === "string" &&
      init.serverInfo.version.trim()) ||
    null;

  return {
    agentVersion,
    sessionCapabilities: {
      close: flag(session.close),
      list: flag(session.list),
      resume: flag(session.resume),
      load: flag(session.load) || loadFromCaps,
    },
    hooks: hooksRaw
      ? {
          blockingEvents: flag(hooksRaw.blockingEvents),
          decisions: flag(hooksRaw.decisions),
          stopSignals: flag(hooksRaw.stopSignals),
        }
      : null,
    toolOverrides: flag(xaiCaps?.toolOverrides),
    statusLine:
      flag(meta?.["x.ai/statusLine"]) || flag(xaiCaps?.statusLine),
    availableCommands,
  };
}
