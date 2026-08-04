import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import {
  buildBrowserCapabilityHandshake,
  buildDeskMcpPrepend,
  detectDeskControlPlanes,
  filterExternalBrowserMcp,
  mergeDeskMcpServers,
  readDeskPlaneEnv,
} from "./desk-mcp-planes.js";

describe("desk-mcp-planes", () => {
  it("readDeskPlaneEnv trims and maps env vars", () => {
    const plane = readDeskPlaneEnv({
      GROKDESK_BROWSER_URL: " http://127.0.0.1:9 ",
      GROKDESK_BROWSER_TOKEN: " tok ",
      GROKDESK_BROWSER_MCP_PATH: " /tmp/browser.mjs ",
      GROKDESK_MCP_NODE_ELECTRON: "1",
    } as NodeJS.ProcessEnv);
    expect(plane.browserUrl).toBe("http://127.0.0.1:9");
    expect(plane.browserToken).toBe("tok");
    expect(plane.electronAsNode).toBe(true);
  });

  it("detectDeskControlPlanes requires path existence", () => {
    const plane = {
      browserUrl: "http://x",
      browserToken: "t",
      browserMcp: "/missing/browser.mjs",
      desktopUrl: "http://d",
      desktopToken: "dt",
      desktopMcp: "/exists/desktop.mjs",
    };
    const det = detectDeskControlPlanes(plane, (p) => p.includes("exists"));
    expect(det.hasBrowser).toBe(false);
    expect(det.hasDesktop).toBe(true);
  });

  it("detects a real browser MCP path in the ESM gateway runtime", () => {
    const det = detectDeskControlPlanes({
      browserUrl: "http://127.0.0.1:9",
      browserToken: "token",
      browserMcp: fileURLToPath(import.meta.url),
    });
    expect(det.hasBrowser).toBe(true);
  });

  it("buildDeskMcpPrepend places desktop before browser and sets ELECTRON_RUN_AS_NODE", () => {
    const prepend = buildDeskMcpPrepend(
      {
        browserUrl: "http://b",
        browserToken: "bt",
        browserMcp: "/b.mjs",
        desktopUrl: "http://d",
        desktopToken: "dt",
        desktopMcp: "/d.mjs",
        mcpNode: "/opt/node",
        electronAsNode: true,
      },
      { hasBrowser: true, hasDesktop: true },
    );
    expect(prepend.map((p) => p.id)).toEqual(["desk-desktop", "desk-browser"]);
    expect(prepend[0]!.command).toBe("/opt/node");
    expect(prepend[0]!.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(prepend[0]!.env.GROKDESK_DESKTOP_TOKEN).toBe("dt");
    // Tokens present for process env but must not appear in logs (callers' duty).
  });

  it("mergeDeskMcpServers drops prior desk entries and prepends fresh ones", () => {
    const merged = mergeDeskMcpServers(
      [
        { id: "desk-browser", command: "old" },
        { id: "user-mcp", command: "u" },
      ],
      [{ id: "desk-browser", command: "new" }],
    );
    expect(merged.map((m) => `${m.id}:${m.command}`)).toEqual([
      "desk-browser:new",
      "user-mcp:u",
    ]);
  });

  it("buildDeskMcpPrepend returns empty when planes unavailable", () => {
    expect(
      buildDeskMcpPrepend({}, { hasBrowser: false, hasDesktop: false }),
    ).toEqual([]);
  });

  it("forces ELECTRON_RUN_AS_NODE when mcpNode path is Electron", () => {
    const prepend = buildDeskMcpPrepend(
      {
        browserUrl: "http://b",
        browserToken: "bt",
        browserMcp: "/b.mjs",
        // Bug regression: Electron under node_modules was selected as "node"
        mcpNode:
          "/app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
        electronAsNode: false,
      },
      { hasBrowser: true, hasDesktop: false },
    );
    expect(prepend).toHaveLength(1);
    expect(prepend[0]!.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("buildBrowserCapabilityHandshake is ready when plane is present", () => {
    const hs = buildBrowserCapabilityHandshake(
      {
        browserUrl: "http://b",
        browserToken: "t",
        browserMcp: "/b.mjs",
      },
      { hasBrowser: true, hasDesktop: false },
    );
    expect(hs.ok).toBe(true);
    expect(hs.provider).toBe("desk-browser");
    expect(hs.tools.length).toBeGreaterThan(0);
  });

  it("filterExternalBrowserMcp disables chrome unless allowed", () => {
    const servers = [
      { id: "desk-browser", enabled: true },
      { id: "chrome", enabled: true },
      { id: "playwright", enabled: true },
    ];
    const blocked = filterExternalBrowserMcp(servers, {
      externalAllowed: false,
      deskBrowserReady: true,
    });
    expect(blocked.find((s) => s.id === "chrome")?.enabled).toBe(false);
    expect(blocked.find((s) => s.id === "desk-browser")?.enabled).toBe(true);
    const allowed = filterExternalBrowserMcp(servers, {
      externalAllowed: true,
      deskBrowserReady: true,
    });
    expect(allowed.find((s) => s.id === "chrome")?.enabled).toBe(true);
  });
});
