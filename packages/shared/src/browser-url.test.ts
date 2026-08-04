import { describe, it, expect } from "vitest";
import {
  parseBrowserUrl,
  isBlockedBrowserUrl,
  originOf,
  isSameOrigin,
} from "./browser-url.js";

describe("browser-url", () => {
  it("parses https URLs", () => {
    const u = parseBrowserUrl("https://example.com/a");
    expect(u?.protocol).toBe("https:");
    expect(originOf(u!)).toBe("https://example.com");
  });

  it("blocks non-HTML file://", () => {
    expect(isBlockedBrowserUrl("file:///etc/passwd").blocked).toBe(true);
  });

  it("allows absolute HTML deliverable paths", () => {
    const p =
      "/Users/me/Library/Application Support/GrokDesk/workspaces/x/index.html";
    expect(isBlockedBrowserUrl(p).blocked).toBe(false);
  });

  it("allows file:// HTML", () => {
    expect(isBlockedBrowserUrl("file:///tmp/site/index.html").blocked).toBe(
      false,
    );
  });

  it("blocks localhost and private IPs", () => {
    expect(isBlockedBrowserUrl("http://127.0.0.1:3000").blocked).toBe(true);
    expect(isBlockedBrowserUrl("http://192.168.1.1/").blocked).toBe(true);
    expect(isBlockedBrowserUrl("http://10.0.0.2/").blocked).toBe(true);
    expect(isBlockedBrowserUrl("http://[::1]/").blocked).toBe(true);
    expect(isBlockedBrowserUrl("http://100.64.1.1/").blocked).toBe(true);
    expect(isBlockedBrowserUrl("http://[::ffff:127.0.0.1]/").blocked).toBe(
      true,
    );
  });

  it("allows public https", () => {
    expect(isBlockedBrowserUrl("https://example.com").blocked).toBe(false);
  });

  it("blocks URLs with embedded credentials", () => {
    expect(
      isBlockedBrowserUrl("https://user:pass@example.com/secret").blocked,
    ).toBe(true);
  });

  it("same origin compares correctly", () => {
    expect(isSameOrigin("https://a.com/x", "https://a.com/y")).toBe(true);
    expect(isSameOrigin("https://a.com", "https://b.com")).toBe(false);
  });
});
