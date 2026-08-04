import { describe, it, expect } from "vitest";
import {
  createBrowserHostTaskState,
  decideBrowserHostTool,
  noteBrowserOpenAllowed,
  browserToolRequestFromArgs,
} from "./browser-host-policy.js";
import type { PolicySnapshot } from "./types.js";

const balanced: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: ["/ws"],
  allowNetworkTools: true,
  allowShell: true,
};

describe("browser-host-policy (shared host/MCP gate)", () => {
  it("denies file:// on host gate", () => {
    const state = createBrowserHostTaskState(balanced);
    const r = decideBrowserHostTool(state, {
      tool: "browser_open",
      url: "file:///etc/passwd",
    });
    expect(r.decision).toBe("deny");
  });

  it("balanced first origin needs approval until noted", () => {
    const state = createBrowserHostTaskState(balanced);
    expect(
      decideBrowserHostTool(state, {
        tool: "browser_open",
        url: "https://example.com",
      }).decision,
    ).toBe("needs_approval");
    noteBrowserOpenAllowed(state, "https://example.com");
    expect(
      decideBrowserHostTool(state, {
        tool: "browser_open",
        url: "https://example.com/x",
      }).decision,
    ).toBe("allow");
  });

  it("autopilot allows public open", () => {
    const state = createBrowserHostTaskState({
      ...balanced,
      approvalMode: "autopilot",
    });
    expect(
      decideBrowserHostTool(state, {
        tool: "browser_open",
        url: "https://example.com",
      }).decision,
    ).toBe("allow");
  });

  it("parses args into tool request", () => {
    const req = browserToolRequestFromArgs("browser_type", {
      submit: true,
      selector: "#q",
    });
    expect(req?.tool).toBe("browser_type");
    expect(req?.submit).toBe(true);
  });

  it("maps path alias to url for browser_open", () => {
    const path =
      "/Users/me/Library/Application Support/GrokDesk/workspaces/x/index.html";
    const req = browserToolRequestFromArgs("browser_open", { path });
    expect(req?.url).toBe(path);
    const state = createBrowserHostTaskState(balanced);
    expect(decideBrowserHostTool(state, req!).decision).toBe("allow");
  });
});

