import { describe, expect, it } from "vitest";
import {
  browserGlobeState,
  browserProviderReceipt,
  initialBrowserCapability,
  mayUseExternalBrowser,
  reduceBrowserCapability,
  shouldAdvertiseDeskBrowser,
} from "./browser-capability";

describe("browser-capability", () => {
  it("starts unavailable and becomes ready on successful handshake", () => {
    let c = initialBrowserCapability();
    expect(shouldAdvertiseDeskBrowser(c)).toBe(false);
    c = reduceBrowserCapability(c, { type: "starting" });
    expect(browserGlobeState(c)).toBe("starting");
    c = reduceBrowserCapability(c, {
      type: "handshake",
      ok: true,
      tools: ["browser.open", "browser.click"],
    });
    expect(c.status).toBe("ready");
    expect(c.provider).toBe("desk-browser");
    expect(shouldAdvertiseDeskBrowser(c)).toBe(true);
    expect(browserGlobeState(c, { activityOpen: true })).toBe("active");
  });

  it("forbids external browser without explicit user choice", () => {
    let c = initialBrowserCapability();
    c = reduceBrowserCapability(c, {
      type: "handshake",
      ok: false,
      reason: "mcp_spawn_failed",
    });
    expect(mayUseExternalBrowser(c)).toBe(false);
    c = reduceBrowserCapability(c, { type: "allow_external", allowed: true });
    expect(mayUseExternalBrowser(c)).toBe(true);
    expect(c.provider).toBe("external-chrome");
  });

  it("records provider in receipts", () => {
    let c = initialBrowserCapability();
    c = reduceBrowserCapability(c, {
      type: "handshake",
      ok: true,
      tools: ["browser.open"],
    });
    expect(browserProviderReceipt(c).browserProvider).toBe("desk-browser");
  });

  it("surfaces blocked and error on globe", () => {
    let c = initialBrowserCapability();
    c = reduceBrowserCapability(c, { type: "blocked" });
    expect(browserGlobeState(c)).toBe("blocked");
    c = reduceBrowserCapability(c, { type: "error", error: "boom" });
    expect(browserGlobeState(c)).toBe("error");
  });
});
