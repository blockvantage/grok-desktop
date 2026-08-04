import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BrowserNavigationCoordinator,
  BrowserService,
  partitionForTask,
  clampBounds,
  decideBrowserNavigation,
  planWindowOpenNavigation,
  BrowserNavigationEpoch,
  navigationTargetsEqual,
  resolveLocalBrowserPath,
  wireBrowserNavigationEvents,
} from "./browser-service";
import { BrowserPolicyStore } from "./browser-policy-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("browser-service helpers", () => {
  it("partitionForTask is stable and isolated", () => {
    expect(partitionForTask("abc")).toBe("persist:grokdesk-task-abc");
    expect(partitionForTask("abc")).not.toBe(partitionForTask("def"));
    expect(partitionForTask("../evil;id")).toBe("persist:grokdesk-task-evilid");
  });

  it("clampBounds rejects non-positive sizes", () => {
    expect(clampBounds({ x: 0, y: 0, width: 0, height: 100 })).toBeNull();
    expect(clampBounds({ x: 1, y: 2, width: 300, height: 400 })).toEqual({
      x: 1,
      y: 2,
      width: 300,
      height: 400,
    });
  });

  it("resolveLocalBrowserPath accepts paths and file URLs with spaces", () => {
    expect(resolveLocalBrowserPath("/tmp/page.html")).toBe("/tmp/page.html");
    expect(
      resolveLocalBrowserPath(
        "file:///Users/me/Application Support/x/emoticons.html",
      ),
    ).toBe("/Users/me/Application Support/x/emoticons.html");
    expect(
      resolveLocalBrowserPath(
        "file:///Users/me/Application%20Support/x/emoticons.html",
      ),
    ).toBe("/Users/me/Application Support/x/emoticons.html");
    expect(resolveLocalBrowserPath("https://example.com")).toBeNull();
  });
});

describe("BrowserService.hideAllExcept (orphan pane guard)", () => {
  it("exports hideAllExcept on the service prototype", async () => {
    // Structural: main process must collapse sibling views when switching chats.
    // Full Electron view attachment is covered by E2E; this asserts the API exists.
    const mod = await import("./browser-service");
    expect(typeof mod.BrowserService).toBe("function");
    expect(typeof mod.BrowserService.prototype.hideAllExcept).toBe("function");
    expect(typeof mod.BrowserService.prototype.setVisible).toBe("function");
  });
});

describe("decideBrowserNavigation", () => {
  const current = "file:///tmp/cuban-cafe/index.html#reserve";
  const mailto = "mailto:hello@casadelhabano.cafe?subject=Table%20request";

  it("keeps email links blocked even when a cached click happens to match", () => {
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: mailto,
        trustedLink: { url: mailto, at: 9_500 },
        now: 10_000,
      }),
    ).toEqual({
      action: "block",
      message: "Navigation blocked: Protocol mailto: is not allowed",
    });
  });

  it("blocks script-triggered email navigation with a useful message", () => {
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: mailto,
        trustedLink: null,
        now: 10_000,
      }),
    ).toEqual({
      action: "block",
      message: "Navigation blocked: Protocol mailto: is not allowed",
    });
  });

  it("does not hand off stale, mismatched, or injected email links", () => {
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: mailto,
        trustedLink: { url: mailto, at: 7_000 },
        now: 10_000,
      }).action,
    ).toBe("block");
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: mailto,
        trustedLink: { url: "mailto:other@example.com", at: 9_500 },
        now: 10_000,
      }).action,
    ).toBe("block");
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: "mailto:hello@example.com?subject=ok%0d%0abcc:bad@example.com",
        trustedLink: {
          url: "mailto:hello@example.com?subject=ok%0d%0abcc:bad@example.com",
          at: 9_500,
        },
        now: 10_000,
      }).action,
    ).toBe("block");
  });

  it("keeps normal preview and public web navigation in the pane", () => {
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: "file:///tmp/cuban-cafe/index.html#menu",
        trustedLink: null,
        now: 10_000,
      }),
    ).toEqual({ action: "allow" });
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: "https://example.com/menu",
        trustedLink: null,
        now: 10_000,
      }),
    ).toEqual({ action: "allow" });
  });

  it("rejects control-character wrapped URLs instead of trimming them into allow", () => {
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: "\r\nhttps://example.com\n",
        trustedLink: null,
        now: 10_000,
      }).action,
    ).toBe("block");
  });

  it("never authorizes external schemes from a coincidental cached click", () => {
    const target = "custom-app://open/private";
    expect(
      decideBrowserNavigation({
        currentUrl: current,
        targetUrl: target,
        trustedLink: { url: target, at: 9_999 },
        now: 10_000,
      }).action,
    ).toBe("block");
  });
});

describe("window-open navigation", () => {
  it("redirects allowed target=_blank navigation into the current in-app pane", () => {
    expect(
      planWindowOpenNavigation({
        currentUrl: "file:///tmp/site/index.html",
        targetUrl: "https://example.com/docs",
      }),
    ).toEqual({ action: "navigate_in_pane", url: "https://example.com/docs" });
  });

  it("keeps prohibited target=_blank schemes blocked", () => {
    expect(
      planWindowOpenNavigation({
        currentUrl: "file:///tmp/site/index.html",
        targetUrl: "custom-app://open/private",
      }).action,
    ).toBe("block");
  });

  it("invalidates an older asynchronous navigation outcome after a newer navigation", () => {
    const epoch = new BrowserNavigationEpoch();
    const older = epoch.begin();
    const newer = epoch.begin();

    expect(epoch.isCurrent(older)).toBe(false);
    expect(epoch.isCurrent(newer)).toBe(true);
  });
});

describe("revision-owned browser navigation", () => {
  it("normalizes equivalent HTTP targets for permit equality", () => {
    expect(
      navigationTargetsEqual("https://example.com", "https://example.com/"),
    ).toBe(true);
  });

  it("continues an authorized HTTP to HTTPS redirect in the original promise", async () => {
    const initial = deferred<{ url: string; title: string }>();
    const redirected = deferred<{ url: string; title: string }>();
    const loads = [initial, redirected];
    const coordinator = new BrowserNavigationCoordinator(
      async () => ({ ok: true }),
      () => loads.shift()!.promise,
      () => {},
    );

    const opened = coordinator.navigate("http://example.com");
    await Promise.resolve();
    coordinator.followRedirect("https://example.com/");
    await Promise.resolve();
    initial.reject(new Error("ERR_ABORTED (-3)"));
    redirected.resolve({ url: "https://example.com/", title: "Secure" });

    await expect(opened).resolves.toMatchObject({
      ok: true,
      url: "https://example.com/",
      title: "Secure",
    });
  });

  it("does not reload same-document navigation or top-load iframe redirects", () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const navigation = {
      navigate: vi.fn(),
      permits: vi.fn(() => false),
      followRedirect: vi.fn(),
    };
    wireBrowserNavigationEvents(
      {
        setWindowOpenHandler: vi.fn(),
        on: (event, listener) => {
          handlers.set(event, listener);
        },
      },
      navigation,
    );

    expect(handlers.has("did-navigate-in-page")).toBe(false);
    const iframeEvent = {
      url: "https://iframe.test/next",
      isMainFrame: false,
      isSameDocument: false,
      preventDefault: vi.fn(),
    };
    handlers.get("will-redirect")?.(iframeEvent);
    expect(iframeEvent.preventDefault).not.toHaveBeenCalled();
    expect(navigation.followRedirect).not.toHaveBeenCalled();

    const mainEvent = {
      url: "https://example.com/secure",
      isMainFrame: true,
      isSameDocument: false,
      preventDefault: vi.fn(),
    };
    handlers.get("will-redirect")?.(mainEvent);
    expect(mainEvent.preventDefault).toHaveBeenCalledOnce();
    expect(navigation.followRedirect).toHaveBeenCalledWith(
      "https://example.com/secure",
    );
  });

  it("revalidates a preauthorized local target immediately before loading", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "grok-browser-exec-swap-"));
    try {
      const root = path.join(parent, "workspace");
      const outside = path.join(parent, "outside.html");
      const target = path.join(root, "index.html");
      mkdirSync(root);
      writeFileSync(target, "safe");
      writeFileSync(outside, "outside");
      const policy = new BrowserPolicyStore();
      policy.configure("task", {
        approvalMode: "autopilot",
        workspaceRoots: [root],
        allowNetworkTools: true,
        allowShell: true,
      });
      const authorization = await policy.authorize(
        "task",
        "browser_open",
        { path: target },
      );
      expect(authorization.ok).toBe(true);
      rmSync(target);
      symlinkSync(outside, target);

      const load = vi.fn(async (url: string) => ({ url, title: "" }));
      const coordinator = new BrowserNavigationCoordinator(
        (url) => policy.authorize("task", "browser_open", { url }),
        load,
        () => {},
        (url) => policy.revalidateLocal("task", url),
      );
      await expect(
        coordinator.navigate(target, authorization),
      ).resolves.toMatchObject({
        ok: false,
        output: expect.stringMatching(/outside/i),
      });
      expect(load).not.toHaveBeenCalled();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("runs full policy before revalidating a new local navigation", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "grok-browser-policy-first-"));
    try {
      const target = path.join(parent, "index.html");
      writeFileSync(target, "safe");
      const policy = new BrowserPolicyStore();
      policy.configure("task", {
        approvalMode: "autopilot",
        workspaceRoots: [parent],
        allowNetworkTools: false,
        allowShell: true,
      });
      const revalidate = vi.spyOn(policy, "revalidateLocal");
      const load = vi.fn(async (url: string) => ({ url, title: "" }));
      const coordinator = new BrowserNavigationCoordinator(
        (url) => policy.authorize("task", "browser_open", { url }),
        load,
        () => {},
        (url) => policy.revalidateLocal("task", url),
      );

      await expect(coordinator.navigate(target)).resolves.toMatchObject({
        ok: false,
        output: expect.stringMatching(/network tools disabled/i),
      });
      expect(revalidate).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("lets the newest same-URL load own the final status", async () => {
    const olderLoad = deferred<{ url: string; title: string }>();
    const newerLoad = deferred<{ url: string; title: string }>();
    const loads = [olderLoad, newerLoad];
    const updates: Array<Record<string, unknown>> = [];
    const coordinator = new BrowserNavigationCoordinator(
      async () => ({ ok: true }),
      () => loads.shift()!.promise,
      (patch) => updates.push(patch),
    );

    const older = coordinator.navigate("https://example.com/same");
    await Promise.resolve();
    const newer = coordinator.navigate("https://example.com/same");
    newerLoad.resolve({ url: "https://example.com/same", title: "new" });
    expect(await newer).toMatchObject({ ok: true, title: "new" });
    olderLoad.resolve({ url: "https://example.com/same", title: "old" });
    expect(await older).toMatchObject({ ok: false, output: "Navigation superseded" });
    expect(updates.at(-1)).toMatchObject({ title: "new", error: null });
  });

  it("ignores an older failure after a newer navigation succeeds", async () => {
    const olderLoad = deferred<{ url: string; title: string }>();
    const newerLoad = deferred<{ url: string; title: string }>();
    const queue = [olderLoad, newerLoad];
    const updates: Array<Record<string, unknown>> = [];
    const coordinator = new BrowserNavigationCoordinator(
      async () => ({ ok: true }),
      () => queue.shift()!.promise,
      (patch) => updates.push(patch),
    );

    const older = coordinator.navigate("https://example.com/old");
    await Promise.resolve();
    const newer = coordinator.navigate("https://example.com/new");
    newerLoad.resolve({ url: "https://example.com/new", title: "new" });
    expect(await newer).toMatchObject({ ok: true, title: "new" });
    olderLoad.reject(new Error("ERR_ABORTED (-3)"));
    expect(await older).toMatchObject({ ok: false, output: "Navigation superseded" });
    expect(updates.some((patch) => patch.error === "ERR_ABORTED (-3)")).toBe(false);
    expect(updates.at(-1)).toMatchObject({ url: "https://example.com/new", title: "new", error: null });
  });

  it("rejects raw CRLF through executable browser_open before loading", async () => {
    const loadURL = vi.fn(async (_url: string) => {});
    const service = new BrowserService(null as never);
    const webContents = {
      getURL: () => "",
      getTitle: () => "",
      loadURL,
    };
    (service as unknown as { ensure: () => Promise<unknown> }).ensure = async () => ({ webContents });
    (service as unknown as { navigations: Map<string, BrowserNavigationCoordinator> }).navigations.set(
      "task",
      new BrowserNavigationCoordinator(
        async (url) => {
          const decision = decideBrowserNavigation({ currentUrl: "", targetUrl: url, trustedLink: null });
          return decision.action === "allow" ? { ok: true } : { ok: false, output: decision.message };
        },
        async (url) => {
          await loadURL(url);
          return { url, title: "" };
        },
        () => {},
      ),
    );

    await expect(
      service.exec("task", "browser_open", { url: "\r\nhttps://example.com\n" }),
    ).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/control/i) });
    expect(loadURL).not.toHaveBeenCalled();
  });
});
