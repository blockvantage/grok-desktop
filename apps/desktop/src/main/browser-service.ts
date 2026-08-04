import type { BrowserWindow } from "electron";
import { session as electronSession } from "electron";
import {
  isBlockedBrowserUrl,
  type BrowserAuthorizeResult,
} from "@grokdesk/shared";

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserStatus = {
  taskId: string;
  url: string;
  title: string;
  loading: boolean;
  error: string | null;
  active: boolean;
  lastAction: string | null;
};

export type BrowserExecResult = {
  ok: boolean;
  output: string;
  screenshot?: string;
  url?: string;
  title?: string;
};

export type TrustedBrowserLink = { url: string; at: number };

export type BrowserNavigationDecision =
  | { action: "allow" }
  | { action: "block"; message: string };

/**
 * Decide a requested in-pane navigation. Browser content never receives an
 * external-protocol escape hatch: http(s) and local HTML stay in the pane;
 * mailto/custom protocols remain blocked.
 */
export function decideBrowserNavigation(opts: {
  currentUrl: string;
  targetUrl: string;
  trustedLink: TrustedBrowserLink | null;
  now?: number;
}): BrowserNavigationDecision {
  const raw = String(opts.targetUrl ?? "");
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) {
    return {
      action: "block",
      message: "Navigation blocked: URL contains control characters",
    };
  }
  const target = raw.trim();
  const blocked = isBlockedBrowserUrl(target);
  if (!blocked.blocked) return { action: "allow" };
  return {
    action: "block",
    message: `Navigation blocked: ${blocked.reason ?? "URL is not allowed"}`,
  };
}

export type WindowOpenNavigationPlan =
  | { action: "navigate_in_pane"; url: string }
  | { action: "block"; message: string };

export function planWindowOpenNavigation(opts: {
  currentUrl: string;
  targetUrl: string;
}): WindowOpenNavigationPlan {
  const decision = decideBrowserNavigation({
    ...opts,
    trustedLink: null,
  });
  if (decision.action === "allow") {
    return { action: "navigate_in_pane", url: opts.targetUrl.trim() };
  }
  return decision;
}

/** Guards async load outcomes from restoring stale status. */
export class BrowserNavigationEpoch {
  private revision = 0;

  begin(): number {
    this.revision += 1;
    return this.revision;
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
}

export function isExpectedNavigationAbort(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return (
    value?.code === -3 ||
    (typeof value?.message === "string" && /ERR_ABORTED/i.test(value.message))
  );
}

type NavigationLoadResult = { url: string; title: string };
type NavigationTransaction = {
  revision: number;
  continuation: Promise<NavigationLoadResult> | null;
};

class NavigationDeniedError extends Error {}

export class BrowserNavigationCoordinator {
  private revision = 0;
  private permit: { revision: number; url: string } | null = null;
  private current: NavigationTransaction | null = null;

  constructor(
    private authorize: (url: string) => Promise<BrowserAuthorizeResult>,
    private load: (url: string) => Promise<NavigationLoadResult>,
    private update: (patch: Partial<BrowserStatus>) => void,
    private revalidateLocal?: (
      url: string,
    ) => BrowserAuthorizeResult | Promise<BrowserAuthorizeResult>,
  ) {}

  permits(url: string): boolean {
    return Boolean(
      this.permit &&
        this.permit.revision === this.revision &&
        navigationTargetsEqual(this.permit.url, url),
    );
  }

  private authorizationForLoad(
    rawUrl: string,
    authorized?: BrowserAuthorizeResult,
  ): BrowserAuthorizeResult | Promise<BrowserAuthorizeResult> {
    // Host-authorized calls already passed approval/full policy and need only
    // the adjacent TOCTOU check. New links/window.open/redirects must always
    // pass full policy first; navigate/followRedirect revalidate after success.
    if (!authorized) return this.authorize(rawUrl);
    return this.revalidateAuthorizedLocal(rawUrl, authorized);
  }

  private revalidateAuthorizedLocal(
    rawUrl: string,
    authz: BrowserAuthorizeResult,
  ): BrowserAuthorizeResult | Promise<BrowserAuthorizeResult> {
    if (!authz.ok) return authz;
    const target = authz.canonicalUrl ?? rawUrl;
    if (resolveLocalBrowserPath(target) === null) return authz;
    return this.revalidateLocal
      ? this.revalidateLocal(target)
      : {
          ok: false,
          output: "Local target cannot be loaded without revalidation",
        };
  }

  followRedirect(rawUrl: string): void {
    const transaction = this.current;
    if (!transaction || transaction.revision !== this.revision) return;
    transaction.continuation = (async () => {
      let authz = await this.authorizationForLoad(rawUrl);
      if (authz.ok && resolveLocalBrowserPath(authz.canonicalUrl ?? rawUrl)) {
        authz = await this.revalidateAuthorizedLocal(rawUrl, authz);
      }
      if (transaction.revision !== this.revision) {
        throw new Error("Navigation superseded");
      }
      if (!authz.ok) throw new NavigationDeniedError(authz.output);
      const target = authz.canonicalUrl ?? rawUrl;
      this.permit = { revision: transaction.revision, url: target };
      return this.load(target);
    })();
  }

  async navigate(
    rawUrl: string,
    authorized?: BrowserAuthorizeResult,
  ): Promise<BrowserExecResult> {
    const revision = ++this.revision;
    const transaction: NavigationTransaction = {
      revision,
      continuation: null,
    };
    this.current = transaction;
    let authz = await this.authorizationForLoad(rawUrl, authorized);
    if (
      !authorized &&
      authz.ok &&
      resolveLocalBrowserPath(authz.canonicalUrl ?? rawUrl)
    ) {
      authz = await this.revalidateAuthorizedLocal(rawUrl, authz);
    }
    if (revision !== this.revision) {
      return { ok: false, output: "Navigation superseded" };
    }
    if (!authz.ok) {
      this.update({ error: authz.output, loading: false, active: true });
      return authz;
    }
    const target = authz.canonicalUrl ?? rawUrl;
    this.permit = { revision, url: target };
    this.update({ loading: true, error: null, active: true });
    try {
      let pending = this.load(target);
      let result: NavigationLoadResult;
      for (;;) {
        try {
          result = await pending;
          break;
        } catch (error) {
          const continuation = transaction.continuation;
          if (
            isExpectedNavigationAbort(error) &&
            continuation &&
            continuation !== pending
          ) {
            pending = continuation;
            continue;
          }
          throw error;
        }
      }
      if (revision !== this.revision) {
        return { ok: false, output: "Navigation superseded" };
      }
      this.update({
        loading: false,
        error: null,
        active: true,
        url: result.url,
        title: result.title,
      });
      return {
        ok: true,
        output: `loaded ${target}`,
        url: result.url,
        title: result.title,
      };
    } catch (error) {
      if (revision !== this.revision || isExpectedNavigationAbort(error)) {
        return { ok: false, output: "Navigation superseded" };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.update({ error: message, loading: false, active: true });
      return { ok: false, output: message };
    } finally {
      if (revision === this.revision) {
        this.permit = null;
        this.current = null;
      }
    }
  }
}

export function partitionForTask(taskId: string): string {
  // Electron partition names should stay alphanumeric-safe; task ids are
  // UUIDs in practice, but clamp anything unexpected before embedding.
  const safe = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
  return `persist:grokdesk-task-${safe || "unknown"}`;
}

export function clampBounds(bounds: BrowserBounds): BrowserBounds | null {
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 1 ||
    bounds.height < 1
  ) {
    return null;
  }
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}

/**
 * Resolve a local filesystem path from browser.open args.
 * Accepts absolute paths, file:// URLs (encoded or with raw spaces), and ~.
 */
export function resolveLocalBrowserPath(url: string): string | null {
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  let raw = url.trim();
  if (raw.startsWith("~")) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (home) raw = home + raw.slice(1);
  }
  if (raw.startsWith("file:")) {
    // file:///Users/me/My%20Docs/a.html  OR  file:///Users/me/My Docs/a.html
    let rest = raw.replace(/^file:\/\//, "");
    // Windows file:///C:/... leaves leading /
    if (/^\/[A-Za-z]:[\\/]/.test(rest)) rest = rest.slice(1);
    try {
      rest = decodeURIComponent(rest);
    } catch {
      // keep raw rest (spaces / unescaped paths)
    }
    return rest || null;
  }
  if (
    !raw.includes("://") &&
    (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw))
  ) {
    return raw;
  }
  return null;
}

export function navigationTargetsEqual(a: string, b: string): boolean {
  const localA = resolveLocalBrowserPath(a);
  const localB = resolveLocalBrowserPath(b);
  if (localA && localB) return localA === localB;
  try {
    const urlA = new URL(a.trim());
    const urlB = new URL(b.trim());
    if (
      (urlA.protocol === "http:" || urlA.protocol === "https:") &&
      (urlB.protocol === "http:" || urlB.protocol === "https:")
    ) {
      return urlA.href === urlB.href;
    }
  } catch {
    // Fall through to exact comparison for invalid/non-standard targets.
  }
  return a.trim() === b.trim();
}

type BrowserNavigationEventDetails = {
  url: string;
  isMainFrame: boolean;
  isSameDocument?: boolean;
  preventDefault: () => void;
};

type BrowserNavigationWebContents = {
  setWindowOpenHandler: (
    handler: (details: { url: string }) => { action: "deny" },
  ) => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

export function wireBrowserNavigationEvents(
  webContents: BrowserNavigationWebContents,
  navigation: Pick<
    BrowserNavigationCoordinator,
    "navigate" | "permits" | "followRedirect"
  >,
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    void navigation.navigate(url);
    return { action: "deny" };
  });
  webContents.on(
    "will-frame-navigate",
    ((details: BrowserNavigationEventDetails) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      if (navigation.permits(details.url)) return;
      details.preventDefault();
      void navigation.navigate(details.url);
    }) as (...args: unknown[]) => void,
  );
  webContents.on(
    "will-redirect",
    ((details: BrowserNavigationEventDetails) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      details.preventDefault();
      navigation.followRedirect(details.url);
    }) as (...args: unknown[]) => void,
  );
  // Same-document anchor/history changes stay inside the loaded document. They
  // must not be fed back through loadURL, which would reload SPA state.
}

type ViewHandle = {
  // Electron WebContentsView | BrowserView — duck typed for both
  webContents: Electron.WebContents;
  setBounds: (b: BrowserBounds) => void;
  setVisible?: (v: boolean) => void;
};

/**
 * Isolated per-task agent browser hosted in Electron main.
 * Uses WebContentsView when available, else BrowserView.
 */
export class BrowserService {
  private views = new Map<string, ViewHandle>();
  private status = new Map<string, BrowserStatus>();
  private listeners = new Set<(s: BrowserStatus) => void>();
  private visible = new Map<string, boolean>();
  private navigations = new Map<string, BrowserNavigationCoordinator>();

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private authorizeNavigation?: (
      taskId: string,
      url: string,
    ) => Promise<BrowserAuthorizeResult>,
    private revalidateLocalNavigation?: (
      taskId: string,
      url: string,
    ) => BrowserAuthorizeResult | Promise<BrowserAuthorizeResult>,
  ) {}

  onStatus(cb: (s: BrowserStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getStatus(taskId: string): BrowserStatus | null {
    return this.status.get(taskId) ?? null;
  }

  private emit(taskId: string, patch: Partial<BrowserStatus>): void {
    const prev = this.status.get(taskId) ?? {
      taskId,
      url: "",
      title: "",
      loading: false,
      error: null,
      active: false,
      lastAction: null,
    };
    const next = { ...prev, ...patch, taskId };
    this.status.set(taskId, next);
    for (const cb of this.listeners) cb(next);
  }

  async ensure(taskId: string): Promise<ViewHandle> {
    const existing = this.views.get(taskId);
    if (existing && !existing.webContents.isDestroyed()) return existing;

    // Cap concurrent WebContents views (heavy). Evict oldest non-visible first.
    const MAX_BROWSER_VIEWS = 32;
    while (this.views.size >= MAX_BROWSER_VIEWS && !this.views.has(taskId)) {
      let victim: string | undefined;
      for (const id of this.views.keys()) {
        if (this.visible.get(id)) continue;
        victim = id;
        break;
      }
      if (!victim) {
        victim = this.views.keys().next().value as string | undefined;
      }
      if (!victim) break;
      await this.destroy(victim).catch(() => {});
    }

    const win = this.getMainWindow();
    if (!win) throw new Error("No main window for browser view");

    // Dynamic require so unit tests can load pure helpers without full Electron view APIs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as typeof import("electron");
    const partition = partitionForTask(taskId);
    const ses = electronSession.fromPartition(partition);

    let handle: ViewHandle;

    if (typeof (electron as { WebContentsView?: unknown }).WebContentsView === "function") {
      const { WebContentsView } = electron as typeof import("electron") & {
        WebContentsView: new (opts: {
          webPreferences: Electron.WebPreferences;
        }) => {
          webContents: Electron.WebContents;
          setBounds: (b: BrowserBounds) => void;
          setVisible?: (v: boolean) => void;
        };
      };
      const view = new WebContentsView({
        webPreferences: {
          session: ses,
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      // Electron 33+: attach via contentView
      const contentView = (
        win as BrowserWindow & {
          contentView?: { addChildView: (v: unknown) => void };
        }
      ).contentView;
      if (contentView?.addChildView) {
        contentView.addChildView(view);
      } else {
        // older shape
        (win as BrowserWindow & { setBrowserView?: (v: unknown) => void }).setBrowserView?.(
          view as unknown,
        );
      }
      handle = view;
    } else {
      const view = new electron.BrowserView({
        webPreferences: {
          session: ses,
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      win.addBrowserView(view);
      handle = {
        webContents: view.webContents,
        setBounds: (b) => view.setBounds(b),
        setVisible: (v) => {
          if (!v) view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        },
      };
    }

    const wc = handle.webContents;
    const navigation = new BrowserNavigationCoordinator(
      async (url) => {
        if (this.authorizeNavigation) {
          return this.authorizeNavigation(taskId, url);
        }
        const decision = decideBrowserNavigation({
          currentUrl: wc.getURL(),
          targetUrl: url,
          trustedLink: null,
        });
        return decision.action === "allow"
          ? { ok: true }
          : { ok: false, output: decision.message };
      },
      async (url) => {
        const localPath = resolveLocalBrowserPath(url);
        // Local paths were realpath/root-checked in the immediately preceding
        // coordinator step. Electron has no descriptor-based loadFile API, so
        // an unavoidable OS-level swap can still occur between check and open.
        if (localPath) await wc.loadFile(localPath);
        else await wc.loadURL(url);
        return { url: wc.getURL(), title: wc.getTitle() };
      },
      (patch) => this.emit(taskId, patch),
      this.revalidateLocalNavigation
        ? (url) => this.revalidateLocalNavigation!(taskId, url)
        : undefined,
    );
    this.navigations.set(taskId, navigation);
    wireBrowserNavigationEvents(
      wc as unknown as BrowserNavigationWebContents,
      navigation,
    );

    this.views.set(taskId, handle);
    this.emit(taskId, { active: true, loading: false });
    if (this.visible.get(taskId)) {
      // keep prior bounds
    } else {
      handle.setVisible?.(false);
      handle.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    return handle;
  }

  /**
   * Apply content-relative bounds from the renderer (getBoundingClientRect).
   * Electron view bounds are in DIP relative to the window content area.
   */
  setBounds(taskId: string, bounds: BrowserBounds | null): void {
    const view = this.views.get(taskId);
    if (!view || view.webContents.isDestroyed()) return;
    if (!bounds) {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      view.setVisible?.(false);
      this.visible.set(taskId, false);
      return;
    }
    // Bounds for one chat must not leave siblings painted over another thread.
    this.hideAllExcept(taskId);
    const c = clampBounds(bounds);
    if (!c) return;
    const win = this.getMainWindow();
    // getBoundingClientRect is already content-relative DIP in Electron renderer.
    // Clamp into the content size to avoid overflow under scale factor.
    let next = c;
    if (win && !win.isDestroyed()) {
      const [cw, ch] = win.getContentSize();
      next = {
        x: Math.max(0, Math.min(c.x, cw - 1)),
        y: Math.max(0, Math.min(c.y, ch - 1)),
        width: Math.max(1, Math.min(c.width, cw - Math.max(0, c.x))),
        height: Math.max(1, Math.min(c.height, ch - Math.max(0, c.y))),
      };
    }
    view.setVisible?.(true);
    view.setBounds(next);
    this.visible.set(taskId, true);
    // User may interact with the live page when the pane is visible (path C).
    try {
      view.webContents.focus();
    } catch {
      // ignore
    }
  }

  /**
   * Collapse a single task's native view to 0×0 (still attached).
   */
  private hideView(taskId: string): void {
    this.visible.set(taskId, false);
    const view = this.views.get(taskId);
    if (!view || view.webContents.isDestroyed()) return;
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    view.setVisible?.(false);
  }

  /**
   * Hide every agent browser view except the one for `exceptTaskId`.
   * Prevents a previous chat's WebContentsView from floating over the next chat.
   */
  hideAllExcept(exceptTaskId: string | null): void {
    for (const id of this.views.keys()) {
      if (exceptTaskId && id === exceptTaskId) continue;
      this.hideView(id);
    }
  }

  setVisible(taskId: string, visible: boolean): void {
    if (!visible) {
      // Closing the pane (or switching to a chat with browser closed): collapse
      // every native view so a prior chat cannot float over the next one.
      this.hideAllExcept(null);
      // Also mark the requested id closed for bookkeeping.
      this.visible.set(taskId, false);
      return;
    }
    // Only one chat's agent browser may be on-screen at a time.
    this.hideAllExcept(taskId);
    this.visible.set(taskId, true);
    const view = this.views.get(taskId);
    if (!view || view.webContents.isDestroyed()) return;
    // Stay hidden until the renderer reports real content bounds via setBounds.
    // Showing at 0×0 (or a stale rect) flashes the native view over the chat.
    view.setVisible?.(false);
  }

  async exec(
    taskId: string,
    tool: string,
    args: Record<string, unknown>,
    authorization?: BrowserAuthorizeResult,
  ): Promise<BrowserExecResult> {
    const view = await this.ensure(taskId);
    const wc = view.webContents;
    this.emit(taskId, { lastAction: tool, active: true });

    try {
      switch (tool) {
        case "browser_open": {
          const url = String(args.url ?? args.path ?? "");
          const navigation = this.navigations.get(taskId);
          if (!navigation) {
            return { ok: false, output: "Browser navigation unavailable" };
          }
          return navigation.navigate(url, authorization);
        }
        case "browser_screenshot": {
          const img = await wc.capturePage();
          const png = img.toPNG();
          const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
          return {
            ok: true,
            output: "screenshot captured",
            screenshot: dataUrl,
            url: wc.getURL(),
            title: wc.getTitle(),
          };
        }
        case "browser_read": {
          const text = (await wc.executeJavaScript(
            `(() => {
              const t = document.body ? (document.body.innerText || "") : "";
              return t.slice(0, 50000);
            })()`,
          )) as string;
          return {
            ok: true,
            output: text || "(empty page)",
            url: wc.getURL(),
            title: wc.getTitle(),
          };
        }
        case "browser_click": {
          const selector =
            typeof args.selector === "string" ? args.selector : null;
          const x = typeof args.x === "number" ? args.x : null;
          const y = typeof args.y === "number" ? args.y : null;
          if (selector) {
            await wc.executeJavaScript(
              `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) throw new Error("Selector not found");
                el.scrollIntoView({ block: "center", inline: "center" });
                el.click();
                return true;
              })()`,
            );
          } else if (x != null && y != null) {
            await wc.executeJavaScript(
              `(() => {
                const el = document.elementFromPoint(${x}, ${y});
                if (!el) throw new Error("No element at coordinates");
                el.click();
                return true;
              })()`,
            );
          } else {
            return {
              ok: false,
              output: "browser_click requires selector or x/y",
            };
          }
          return {
            ok: true,
            output: "clicked",
            url: wc.getURL(),
            title: wc.getTitle(),
          };
        }
        case "browser_type": {
          const selector =
            typeof args.selector === "string" ? args.selector : null;
          const text = String(args.text ?? args.value ?? "");
          const submit = args.submit === true;
          if (!selector) {
            return { ok: false, output: "browser_type requires selector" };
          }
          await wc.executeJavaScript(
            `(() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) throw new Error("Selector not found");
              el.focus();
              if ("value" in el) {
                el.value = ${JSON.stringify(text)};
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              } else {
                el.textContent = ${JSON.stringify(text)};
              }
              if (${submit ? "true" : "false"}) {
                if (el.form && typeof el.form.requestSubmit === "function") {
                  el.form.requestSubmit();
                } else {
                  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                }
              }
              return true;
            })()`,
          );
          return {
            ok: true,
            output: submit ? "typed+submit" : "typed",
            url: wc.getURL(),
            title: wc.getTitle(),
          };
        }
        case "browser_scroll": {
          const dy =
            typeof args.dy === "number"
              ? args.dy
              : typeof args.y === "number"
                ? args.y
                : 400;
          const selector =
            typeof args.selector === "string" ? args.selector : null;
          if (selector) {
            await wc.executeJavaScript(
              `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) throw new Error("Selector not found");
                el.scrollBy(0, ${dy});
                return true;
              })()`,
            );
          } else {
            await wc.executeJavaScript(`window.scrollBy(0, ${dy}); true`);
          }
          return {
            ok: true,
            output: `scrolled ${dy}`,
            url: wc.getURL(),
            title: wc.getTitle(),
          };
        }
        default:
          return { ok: false, output: `Unknown browser tool: ${tool}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit(taskId, { error: message, loading: false });
      return { ok: false, output: message };
    }
  }

  async destroy(taskId: string): Promise<void> {
    const view = this.views.get(taskId);
    this.views.delete(taskId);
    this.visible.delete(taskId);
    this.navigations.delete(taskId);
    if (view && !view.webContents.isDestroyed()) {
      try {
        const win = this.getMainWindow();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require("electron") as typeof import("electron");
        if (win && typeof electron.BrowserView === "function") {
          try {
            win.removeBrowserView(view as unknown as Electron.BrowserView);
          } catch {
            // WebContentsView path
          }
        }
        const contentView = (
          win as BrowserWindow & {
            contentView?: { removeChildView?: (v: unknown) => void };
          }
        )?.contentView;
        contentView?.removeChildView?.(view);
        view.webContents.close();
      } catch {
        // ignore
      }
    }
    try {
      const ses = electronSession.fromPartition(partitionForTask(taskId));
      await ses.clearStorageData();
    } catch {
      // ignore
    }
    this.status.delete(taskId);
    this.emit(taskId, {
      active: false,
      loading: false,
      url: "",
      title: "",
      error: null,
      lastAction: null,
    });
  }
}
