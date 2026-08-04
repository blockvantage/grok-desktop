/**
 * Pure builders for desk-browser / desk-desktop MCP injection (Phase 6 extract).
 * No process spawn — only config assembly from env + filesystem probes.
 */

import { existsSync as nodeExistsSync } from "node:fs";

export type DeskMcpServerConfig = {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
};

export type DeskPlaneEnv = {
  browserUrl?: string;
  browserToken?: string;
  browserMcp?: string;
  desktopUrl?: string;
  desktopToken?: string;
  desktopMcp?: string;
  mcpNode?: string;
  electronAsNode?: boolean;
};

export function readDeskPlaneEnv(
  env: NodeJS.ProcessEnv = process.env,
): DeskPlaneEnv {
  return {
    browserUrl: env.GROKDESK_BROWSER_URL?.trim() || undefined,
    browserToken: env.GROKDESK_BROWSER_TOKEN?.trim() || undefined,
    browserMcp: env.GROKDESK_BROWSER_MCP_PATH?.trim() || undefined,
    desktopUrl: env.GROKDESK_DESKTOP_URL?.trim() || undefined,
    desktopToken: env.GROKDESK_DESKTOP_TOKEN?.trim() || undefined,
    desktopMcp: env.GROKDESK_DESKTOP_MCP_PATH?.trim() || undefined,
    mcpNode:
      env.GROKDESK_MCP_NODE?.trim() ||
      env.GROKDESK_NODE_PATH?.trim() ||
      undefined,
    electronAsNode:
      env.GROKDESK_MCP_NODE_ELECTRON === "1" ||
      env.ELECTRON_RUN_AS_NODE === "1",
  };
}

/**
 * Detect which control planes are fully configured and present on disk.
 */
export function detectDeskControlPlanes(
  plane: DeskPlaneEnv,
  existsSync: (p: string) => boolean = nodeExistsSync,
): { hasBrowser: boolean; hasDesktop: boolean } {
  const hasBrowser = !!(
    plane.browserUrl &&
    plane.browserToken &&
    plane.browserMcp &&
    existsSync(plane.browserMcp)
  );
  const hasDesktop = !!(
    plane.desktopUrl &&
    plane.desktopToken &&
    plane.desktopMcp &&
    existsSync(plane.desktopMcp)
  );
  return { hasBrowser, hasDesktop };
}

/**
 * Build prepend MCP server entries for desk-desktop / desk-browser.
 * Tokens are included for the engine process only — callers must not log them.
 */
export function buildDeskMcpPrepend(
  plane: DeskPlaneEnv,
  detection: { hasBrowser: boolean; hasDesktop: boolean },
): DeskMcpServerConfig[] {
  const prepend: DeskMcpServerConfig[] = [];
  const mcpNode = plane.mcpNode || "node";
  // Always force Electron-as-Node when the interpreter path is Electron —
  // otherwise MCP children open as GUI apps and desk-browser tools vanish.
  const commandIsElectron = /electron/i.test(mcpNode);
  const mcpNodeEnv: Record<string, string> = {};
  if (plane.electronAsNode || commandIsElectron) {
    mcpNodeEnv.ELECTRON_RUN_AS_NODE = "1";
  }

  if (detection.hasDesktop && plane.desktopMcp && plane.desktopUrl && plane.desktopToken) {
    prepend.push({
      id: "desk-desktop",
      command: mcpNode,
      args: [plane.desktopMcp],
      env: {
        ...mcpNodeEnv,
        GROKDESK_DESKTOP_URL: plane.desktopUrl,
        GROKDESK_DESKTOP_TOKEN: plane.desktopToken,
      },
      enabled: true,
    });
  }
  if (detection.hasBrowser && plane.browserMcp && plane.browserUrl && plane.browserToken) {
    prepend.push({
      id: "desk-browser",
      command: mcpNode,
      args: [plane.browserMcp],
      env: {
        ...mcpNodeEnv,
        GROKDESK_BROWSER_URL: plane.browserUrl,
        GROKDESK_BROWSER_TOKEN: plane.browserToken,
      },
      enabled: true,
    });
  }
  return prepend;
}

/**
 * Merge desk prepend servers ahead of user MCP list, dropping prior desk entries.
 */
export function mergeDeskMcpServers<
  T extends { id: string },
>(
  existing: T[],
  prepend: T[],
): T[] {
  const without = existing.filter(
    (m) => m.id !== "desk-browser" && m.id !== "desk-desktop",
  );
  return [...prepend, ...without];
}

/** MCP ids that imply external Chrome / headless browser tooling. */
const EXTERNAL_BROWSER_MCP_IDS =
  /^(chrome|browser|playwright|puppeteer|browserbase|browser-use)/i;

/**
 * Strip automatic external browser MCP servers unless the user explicitly
 * allowed external browser for this session/task.
 */
export function filterExternalBrowserMcp<T extends { id: string; enabled?: boolean }>(
  servers: T[],
  opts: { externalAllowed: boolean; deskBrowserReady: boolean },
): T[] {
  if (opts.externalAllowed || !opts.deskBrowserReady) {
    // When desk-browser is not ready, still do not silently enable external
    // unless allowed — disable matching ids instead of removing so UI can show them.
    if (opts.externalAllowed) return servers;
    return servers.map((s) =>
      EXTERNAL_BROWSER_MCP_IDS.test(s.id)
        ? { ...s, enabled: false }
        : s,
    );
  }
  // Desk browser is primary: disable competing external browser connectors.
  return servers.map((s) =>
    EXTERNAL_BROWSER_MCP_IDS.test(s.id) ? { ...s, enabled: false } : s,
  );
}

export type BrowserCapabilityHandshake = {
  ok: boolean;
  status: "unavailable" | "ready" | "degraded";
  reason:
    | "host_missing"
    | "mcp_spawn_failed"
    | "tools_not_discovered"
    | "healthy"
    | "unknown";
  tools: string[];
  provider: "desk-browser" | "none";
  verifiedAt: string;
};

/**
 * Verified in-app browser capability record for pre-run handshake.
 * Secrets (tokens) are never included.
 */
export function buildBrowserCapabilityHandshake(
  plane: DeskPlaneEnv,
  detection: { hasBrowser: boolean; hasDesktop: boolean },
  opts?: { toolsDiscovered?: string[]; at?: string },
): BrowserCapabilityHandshake {
  const at = opts?.at ?? new Date().toISOString();
  const tools = opts?.toolsDiscovered ?? [
    "browser_open",
    "browser_click",
    "browser_type",
    "browser_scroll",
    "browser_screenshot",
    "browser_read",
  ];
  if (!detection.hasBrowser) {
    return {
      ok: false,
      status: "unavailable",
      reason: plane.browserMcp ? "mcp_spawn_failed" : "host_missing",
      tools: [],
      provider: "none",
      verifiedAt: at,
    };
  }
  if (!tools.length) {
    return {
      ok: false,
      status: "degraded",
      reason: "tools_not_discovered",
      tools: [],
      provider: "desk-browser",
      verifiedAt: at,
    };
  }
  return {
    ok: true,
    status: "ready",
    reason: "healthy",
    tools,
    provider: "desk-browser",
    verifiedAt: at,
  };
}
