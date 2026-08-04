import { describe, it, expect } from "vitest";
import {
  decideExternalUrl,
  decideRendererNavigation,
  sanitizeMarkdownHref,
} from "../security-url.js";
import {
  validatePrivilegedIpcSender,
  isTrustedSenderUrl,
} from "../ipc-sender.js";

describe("SEC-03 Electron URL / navigation / IPC", () => {
  it("allows only http/https external URLs", () => {
    expect(decideExternalUrl("https://example.com/x").allowed).toBe(true);
    expect(decideExternalUrl("http://example.com").allowed).toBe(true);
  });

  it("rejects javascript, data, file, and custom schemes", () => {
    expect(decideExternalUrl("javascript:alert(1)").allowed).toBe(false);
    expect(decideExternalUrl("data:text/html,hi").allowed).toBe(false);
    expect(decideExternalUrl("file:///etc/passwd").allowed).toBe(false);
    expect(decideExternalUrl("myapp://open").allowed).toBe(false);
    expect(decideExternalUrl("vbscript:msgbox").allowed).toBe(false);
  });

  it("denies same-window navigation away from packaged renderer", () => {
    const d = decideRendererNavigation({
      currentUrl: "file:///app/index.html",
      targetUrl: "https://evil.example/phish",
    });
    expect(d.allow).toBe(false);
  });

  it("allows hash-only navigation on same file", () => {
    const d = decideRendererNavigation({
      currentUrl: "file:///app/index.html",
      targetUrl: "file:///app/index.html#settings",
    });
    expect(d.allow).toBe(true);
  });

  it("allows dev server same-origin when configured", () => {
    const d = decideRendererNavigation({
      currentUrl: "http://localhost:5173/",
      targetUrl: "http://localhost:5173/foo",
      devServerOrigin: "http://localhost:5173",
    });
    expect(d.allow).toBe(true);
  });

  it("blocks untrusted IPC senders", () => {
    const mainWc = { id: 1, getURL: () => "file:///app/index.html" };
    const evil = { id: 99, getURL: () => "https://evil.example/" };
    const bad = validatePrivilegedIpcSender({
      sender: evil,
      mainWindow: { id: 10, webContents: mainWc },
    });
    expect(bad.ok).toBe(false);

    const good = validatePrivilegedIpcSender({
      sender: mainWc,
      mainWindow: { id: 10, webContents: mainWc },
    });
    expect(good.ok).toBe(true);
  });

  it("rejects non-main senders with missing URL (fail-closed)", () => {
    const mainWc = { id: 1, getURL: () => "file:///app/index.html" };
    const noUrl = { id: 1, getURL: () => "" };
    // Same id as main but different object and empty URL → reject.
    const spoof = validatePrivilegedIpcSender({
      sender: noUrl,
      mainWindow: { id: 10, webContents: mainWc },
    });
    expect(spoof.ok).toBe(false);
    if (!spoof.ok) expect(spoof.reason).toMatch(/missing sender url/);

    // Exact main webContents reference may omit URL during load race.
    const mainNoUrl = { id: 1, getURL: () => "" };
    const duringLoad = validatePrivilegedIpcSender({
      sender: mainNoUrl,
      mainWindow: { id: 10, webContents: mainNoUrl },
    });
    expect(duringLoad.ok).toBe(true);
  });

  it("isTrustedSenderUrl rejects remote origins in packaged mode", () => {
    expect(isTrustedSenderUrl("https://evil.example/", null)).toBe(false);
    expect(isTrustedSenderUrl("file:///app/index.html", null)).toBe(true);
  });

  it("isTrustedSenderUrl rejects unrelated file:// when main window is known", () => {
    const main = "file:///Applications/Grok Desk.app/Contents/Resources/app/index.html";
    expect(
      isTrustedSenderUrl("file:///etc/passwd", null, { mainWindowUrl: main }),
    ).toBe(false);
    expect(
      isTrustedSenderUrl(
        "file:///Applications/Grok Desk.app/Contents/Resources/app/index.html",
        null,
        { mainWindowUrl: main },
      ),
    ).toBe(true);
    expect(
      isTrustedSenderUrl(
        "file:///Applications/Grok Desk.app/Contents/Resources/app/other.html",
        null,
        { mainWindowUrl: main },
      ),
    ).toBe(true);
  });

  it("sanitizeMarkdownHref blocks dangerous schemes", () => {
    expect(sanitizeMarkdownHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeMarkdownHref("https://ok.example")).toMatch(/^https:/);
    expect(sanitizeMarkdownHref("#section")).toBe("#section");
  });
});
