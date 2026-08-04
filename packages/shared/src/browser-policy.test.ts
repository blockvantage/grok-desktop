import { describe, it, expect } from "vitest";
import { evaluateBrowserToolRequest } from "./browser-policy.js";
import type { PolicySnapshot } from "./types.js";

const base: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: ["/ws"],
  allowNetworkTools: true,
  allowShell: true,
};

function session(origins: string[] = []) {
  return { approvedOrigins: new Set(origins), elevatedNetwork: false };
}

describe("evaluateBrowserToolRequest", () => {
  it("denies non-HTML file:// open", () => {
    const r = evaluateBrowserToolRequest(
      base,
      { tool: "browser_open", url: "file:///tmp/x" },
      session(),
    );
    expect(r.decision).toBe("deny");
  });

  it("allows absolute workspace HTML path (not Invalid URL)", () => {
    const path =
      "/Users/me/Library/Application Support/GrokDesk/workspaces/x/index.html";
    const r = evaluateBrowserToolRequest(
      base,
      { tool: "browser_open", url: path },
      session(),
    );
    expect(r.decision).toBe("allow");
    expect(r.reason).toMatch(/local html/i);
  });

  it("allows file:// HTML deliverable", () => {
    const r = evaluateBrowserToolRequest(
      { ...base, approvalMode: "autopilot" },
      { tool: "browser_open", url: "file:///tmp/site/index.html" },
      session(),
    );
    expect(r.decision).toBe("allow");
  });

  it("never asks First visit to null for file:// HTML in balanced mode", () => {
    const r = evaluateBrowserToolRequest(
      base,
      {
        tool: "browser_open",
        url: "file:///Users/me/Library/Application%20Support/GrokDesk/workspaces/x/panda-site/index.html",
      },
      session(),
    );
    expect(r.decision).toBe("allow");
    expect(r.reason ?? "").not.toMatch(/null/i);
  });

  it("balanced: first origin needs approval, second same origin allows", () => {
    const first = evaluateBrowserToolRequest(
      base,
      { tool: "browser_open", url: "https://example.com" },
      session(),
    );
    expect(first.decision).toBe("needs_approval");

    const second = evaluateBrowserToolRequest(
      base,
      { tool: "browser_open", url: "https://example.com/pricing" },
      session(["https://example.com"]),
    );
    expect(second.decision).toBe("allow");
  });

  it("balanced: click/type/scroll/read/screenshot allow without approval when not submit", () => {
    for (const tool of [
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_read",
      "browser_screenshot",
    ] as const) {
      const r = evaluateBrowserToolRequest(base, { tool }, session());
      expect(r.decision).toBe("allow");
    }
  });

  it("balanced: type with submit needs approval", () => {
    const r = evaluateBrowserToolRequest(
      base,
      { tool: "browser_type", submit: true },
      session(),
    );
    expect(r.decision).toBe("needs_approval");
  });

  it("strict: open and click need approval", () => {
    const strict = { ...base, approvalMode: "strict" as const };
    expect(
      evaluateBrowserToolRequest(
        strict,
        { tool: "browser_open", url: "https://example.com" },
        session(["https://example.com"]),
      ).decision,
    ).toBe("needs_approval");
    expect(
      evaluateBrowserToolRequest(strict, { tool: "browser_click" }, session())
        .decision,
    ).toBe("needs_approval");
  });

  it("autopilot allows open of public URL", () => {
    const auto = { ...base, approvalMode: "autopilot" as const };
    expect(
      evaluateBrowserToolRequest(
        auto,
        { tool: "browser_open", url: "https://example.com" },
        session(),
      ).decision,
    ).toBe("allow");
  });

  it("denies browser tools when allowNetworkTools is false", () => {
    const noNet = { ...base, allowNetworkTools: false };
    expect(
      evaluateBrowserToolRequest(
        noNet,
        { tool: "browser_open", url: "https://example.com" },
        session(),
      ).decision,
    ).toBe("deny");
  });

  it("blocks private IP open without elevation", () => {
    const r = evaluateBrowserToolRequest(
      base,
      { tool: "browser_open", url: "http://127.0.0.1:8080" },
      session(),
    );
    expect(r.decision).toBe("deny");
  });
});
