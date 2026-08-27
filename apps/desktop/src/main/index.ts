import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  protocol,
  session,
  clipboard,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerIpc, unregisterIpc } from "./ipc-bridge";
import { GatewayProcess } from "./gateway-process";
import { wirePowerMonitor } from "./power-monitor";
import { pickDirectory, pickFiles } from "./dialog";
import { createAppTray } from "./tray";
import { mt, setMainLocale } from "./main-i18n";
import { notifyNeedsYou } from "./notifications";
import {
  collectRevealAllowedRoots,
  resolveGatewayDataDir,
  revealInFileManager,
} from "./reveal";
import {
  registerAssetSchemePrivileged,
  registerAssetProtocolHandler,
} from "./asset-protocol";
import { initMainLog, mainLog, getLogDir, getRecentLogLines } from "./log";
import type { GatewayLifecycleStatus } from "./redact";
import { BrowserService } from "./browser-service";
import { startBrowserHostServer } from "./browser-host-server";
import { BrowserPolicyStore } from "./browser-policy-store";
import { registerDictationIpc } from "./dictation-service";
import { dictationGateFromStatus } from "./dictation-entitlement";
import { type PolicySnapshot } from "@grokdesk/shared";
import { DesktopPolicyStore } from "./desktop-policy-store";
import { DesktopUseService } from "./desktop-use-service";
import { startDesktopHostServer } from "./desktop-host-server";
import { createDesktopAdapter } from "./desktop/select-adapter";
import { decideExternalUrl, decideRendererNavigation } from "./security-url";
import { validatePrivilegedIpcSender } from "./ipc-sender";
import { registerPrivilegedHandle } from "./privileged-ipc";
import {
  registerE2eTestControls,
  unregisterE2eTestControls,
} from "./e2e-test-controls";
import { DEFAULT_ENTITLEMENT_API_URL } from "./entitlements/bootstrap";
import {
  createGatewayUpdateHealth,
  createRebuildGatewayHandler,
  createUpdateBootstrap,
  isUpdateIdleTrayStatus,
  type UpdateBootstrap,
} from "./updates/bootstrap";
import {
  createUpdateIpcHandlers,
  registerUpdateIpc,
  toSafeUpdateStatus,
  unregisterUpdateIpc,
} from "./updates/update-ipc";
import { UPDATE_MAIN_IPC_CHANNELS } from "@grokdesk/shared";

let mainWindow: BrowserWindow | null = null;
let gateway: GatewayProcess | null = null;
let lastTrayStatus = "idle";
let browserService: BrowserService | null = null;
let browserPolicyStore: BrowserPolicyStore | null = null;
let browserHostClose: (() => Promise<void>) | null = null;
let desktopPolicyStore: DesktopPolicyStore | null = null;
let desktopUseService: DesktopUseService | null = null;
let desktopHostClose: (() => Promise<void>) | null = null;
let updateBootstrap: UpdateBootstrap | null = null;

declare const __GROKDESK_ENTITLEMENT_API_URL__: string | undefined;
declare const __GROKDESK_MANIFEST_URL__: string | undefined;
declare const __GROKDESK_DEV_UNLOCK__: boolean | string | undefined;

function bakedValue(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** True when compile baked unlock (install builds that skip product-key gate). */
function isBakedDevUnlock(): boolean {
  try {
    const v = __GROKDESK_DEV_UNLOCK__;
    return v === true || v === "true" || v === "1";
  } catch {
    return false;
  }
}

/** Windows taskbar / toast grouping; must match electron-builder appId. */
if (process.platform === "win32") {
  app.setAppUserModelId("ai.x.grokdesk");
}

// Custom media scheme must be privileged before app ready.
registerAssetSchemePrivileged(protocol);

function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, "../renderer/grok-desk-icon.png"),
    path.join(__dirname, "../renderer/grok-desk-icon-full.png"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function resolveBrowserMcpPath(): string {
  const candidates = [
    // Packaged: electron-builder extraResources
    path.join(process.resourcesPath, "browser-mcp-server.mjs"),
    // Dev monorepo
    path.join(__dirname, "../../resources/browser-mcp-server.mjs"),
    path.join(app.getAppPath(), "resources/browser-mcp-server.mjs"),
    path.resolve(process.cwd(), "apps/desktop/resources/browser-mcp-server.mjs"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[1]!;
}

function resolveDesktopMcpPath(): string {
  const candidates = [
    path.join(process.resourcesPath, "desktop-mcp-server.mjs"),
    path.join(__dirname, "../../resources/desktop-mcp-server.mjs"),
    path.join(app.getAppPath(), "resources/desktop-mcp-server.mjs"),
    path.resolve(process.cwd(), "apps/desktop/resources/desktop-mcp-server.mjs"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[1]!;
}

async function createWindow(): Promise<void> {
  const icon = resolveWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: "Grok Desk",
    ...(icon ? { icon } : {}),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 18 },
          vibrancy: "sidebar" as const,
          visualEffectState: "active" as const,
        }
      : {}),
    backgroundColor: "#050e21",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // SEC-03: sandbox the renderer when possible. Preload remains isolated.
      sandbox: true,
      // Explicit fail-closed (Electron default is true; pin so a future API drift is loud).
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Deny every same-window navigation away from the trusted packaged renderer.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const decision = decideRendererNavigation({
      currentUrl: mainWindow?.webContents.getURL() ?? "",
      targetUrl: url,
      devServerOrigin: process.env.ELECTRON_RENDERER_URL ?? null,
    });
    if (!decision.allow) {
      event.preventDefault();
      mainLog(
        "warn",
        "navigation_blocked",
        JSON.stringify({ url, reason: decision.reason }),
      );
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideExternalUrl(url);
    if (decision.allowed) {
      void shell.openExternal(decision.url);
    } else {
      mainLog(
        "warn",
        "open_external_blocked",
        JSON.stringify({ url, reason: decision.reason }),
      );
    }
    return { action: "deny" };
  });

  // Narrow media permission requests to the trusted renderer origin.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const url = webContents.getURL();
      const trusted = decideRendererNavigation({
        currentUrl: mainWindow?.webContents.getURL() ?? url,
        targetUrl: url,
        devServerOrigin: process.env.ELECTRON_RENDERER_URL ?? null,
      });
      // Electron PermissionRequestHandler uses "media" (not mic/camera separately).
      const mediaOk =
        permission === "media" || permission === "mediaKeySystem";
      if (trusted.allow && mediaOk) {
        callback(true);
        return;
      }
      callback(false);
    },
  );

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

/** Validate IPC sender for privileged main-process handlers. */
export function assertPrivilegedIpcSender(event: {
  sender: Electron.WebContents;
}): void {
  const check = validatePrivilegedIpcSender({
    sender: event.sender,
    mainWindow,
    trustedDevOrigin: process.env.ELECTRON_RENDERER_URL ?? null,
  });
  if (!check.ok) {
    throw new Error(`IPC sender rejected: ${check.reason}`);
  }
}

/** Main window accessor for privileged IPC composition. */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * User-picked / task workspace roots allowed for reveal (secondary project
 * folders attached via pickDirectory). Survives for the app session.
 */
const extraRevealRoots = new Set<string>();
const EXTRA_REVEAL_ROOTS_MAX = 64;

function rememberRevealRoot(p: string | null | undefined): void {
  if (typeof p === "string" && p.trim()) {
    const abs = path.resolve(p.trim());
    if (extraRevealRoots.has(abs)) return;
    // FIFO-ish: drop an arbitrary oldest entry when full (Set insertion order).
    if (extraRevealRoots.size >= EXTRA_REVEAL_ROOTS_MAX) {
      const first = extraRevealRoots.values().next().value as
        | string
        | undefined;
      if (first !== undefined) extraRevealRoots.delete(first);
    }
    extraRevealRoots.add(abs);
  }
}

/**
 * Allowed reveal roots: managed workspaces / exports / attachments / logs /
 * downloads + session extras + live task workspace roots from gateway.
 */
async function getRevealAllowedRoots(): Promise<string[]> {
  const extra: string[] = [...extraRevealRoots];
  if (gateway) {
    try {
      const list = (await gateway.request("tasks.list", {})) as Array<{
        policySnapshot?: { workspaceRoots?: string[] };
      }>;
      if (Array.isArray(list)) {
        for (const t of list) {
          for (const r of t.policySnapshot?.workspaceRoots ?? []) {
            if (typeof r === "string" && r.trim()) {
              extra.push(path.resolve(r.trim()));
            }
          }
        }
      }
    } catch {
      /* gateway unavailable — static roots still apply */
    }
  }
  let downloads: string | null = null;
  try {
    downloads = app.getPath("downloads");
  } catch {
    downloads = null;
  }
  return collectRevealAllowedRoots({
    userDataDir: app.getPath("userData"),
    dataDir: resolveGatewayDataDir({
      platform: process.platform,
      home: process.env.HOME || process.env.USERPROFILE || os.homedir(),
      appData: process.env.APPDATA,
    }),
    downloadsDir: downloads,
    extraRoots: extra,
  });
}

function pushGatewayStatus(status: GatewayLifecycleStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("grokdesk:gateway-status", status);
  }
}

function pushGatewayNotify(
  method: string,
  params: Record<string, unknown>,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("grokdesk:gateway-notify", { method, params });
  }
}

function registerDesktopIpc(): void {
  // Every privileged handler: gate sender first (same as entitlements / updates).
  const gate = (event: unknown) => {
    assertPrivilegedIpcSender(
      event as { sender: Electron.WebContents },
    );
  };

  // LANG-4: renderer pushes resolved UI locale so tray/dialogs follow.
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:app:setLocale",
    gate,
    async (_e, locale: unknown) => {
      if (typeof locale === "string" && locale.trim()) {
        setMainLocale(locale.trim());
      }
      return { ok: true as const };
    },
  );
  registerPrivilegedHandle(ipcMain, "grokdesk:pickDirectory", gate, async () => {
    const dir = await pickDirectory(mainWindow);
    rememberRevealRoot(dir);
    return dir;
  });
  registerPrivilegedHandle(ipcMain, "grokdesk:pickFiles", gate, async () => {
    const files = await pickFiles(mainWindow);
    for (const f of files) {
      rememberRevealRoot(path.dirname(f));
    }
    return files;
  });
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:writeTempAttachment",
    gate,
    async (_e, payload: unknown) => {
      const body = payload as { name?: string; base64?: string };
      try {
        const safe = String(body?.name || "paste.bin").replace(
          /[^\w.\-]+/g,
          "-",
        );
        // Cap decoded size (~25MB) so paste/voice cannot fill the disk.
        const b64 = String(body?.base64 ?? "");
        const approxBytes = Math.floor((b64.length * 3) / 4);
        const MAX_TEMP_BYTES = 25 * 1024 * 1024;
        if (approxBytes > MAX_TEMP_BYTES) {
          return { ok: false as const, error: "too_large" };
        }
        const dir = path.join(app.getPath("userData"), "pending-attachments");
        fs.mkdirSync(dir, { recursive: true });
        // Best-effort prune files older than 24h so paste staging cannot grow forever.
        try {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          for (const name of fs.readdirSync(dir).slice(0, 200)) {
            const p = path.join(dir, name);
            try {
              const st = fs.statSync(p);
              if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(p);
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
        const file = path.join(dir, `${Date.now()}-${safe}`);
        const buf = Buffer.from(b64, "base64");
        if (buf.length > MAX_TEMP_BYTES) {
          return { ok: false as const, error: "too_large" };
        }
        fs.writeFileSync(file, buf);
        return { ok: true as const, path: file };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:reveal",
    gate,
    async (_e, filePath: unknown) => {
      const allowedRoots = await getRevealAllowedRoots();
      return revealInFileManager(String(filePath ?? ""), { allowedRoots });
    },
  );
  registerPrivilegedHandle(ipcMain, "grokdesk:gatewayStatus", gate, async () => {
    return gateway?.getStatus() ?? "idle";
  });
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:restartGateway",
    gate,
    async () => {
      if (!gateway) return { ok: false, error: "gateway_unavailable" };
      try {
        await gateway.restart();
        return { ok: true, status: gateway.getStatus() };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
  registerPrivilegedHandle(ipcMain, "grokdesk:openLogs", gate, async () => {
    const dir = getLogDir();
    if (!dir) return { ok: false };
    await shell.openPath(dir);
    return { ok: true, path: dir };
  });
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:copyDiagnostics",
    gate,
    async () => {
      const { clipboard } = await import("electron");
      const lines = [
        `Grok Desk ${app.getVersion()}`,
        `platform=${process.platform} arch=${process.arch}`,
        `electron=${process.versions.electron} node=${process.versions.node}`,
        `gateway=${gateway?.getStatus() ?? "idle"}`,
        `userData=${app.getPath("userData")}`,
        `logs=${getLogDir() ?? "n/a"}`,
        "productLicense=free",
      ];
      // Content-free outbox aggregates for support (counts/age only).
      if (gateway?.getStatus() === "ready") {
        try {
          const summary = (await gateway.request(
            "outbox.summary",
            {},
            { timeoutMs: 5_000 },
          )) as {
            total?: number;
            byStatus?: Record<string, number>;
            oldestPendingAgeMs?: number | null;
          };
          lines.push("--- outbox summary ---");
          lines.push(`outbox.total=${summary.total ?? 0}`);
          if (summary.byStatus) {
            for (const [status, n] of Object.entries(summary.byStatus)) {
              lines.push(`outbox.${status}=${n}`);
            }
          }
          if (summary.oldestPendingAgeMs != null) {
            lines.push(`outbox.oldestPendingAgeMs=${summary.oldestPendingAgeMs}`);
          }
        } catch {
          lines.push("outbox.summary=unavailable");
        }
      }
      lines.push("--- recent log ---", ...getRecentLogLines(50));
      const text = lines.join("\n");
      clipboard.writeText(text);
      return { ok: true, text };
    },
  );

  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:browser:status",
    gate,
    (_e, taskId: unknown) => {
      return browserService?.getStatus(String(taskId)) ?? null;
    },
  );
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:browser:setBounds",
    gate,
    (
      _e,
      taskId: unknown,
      bounds: unknown,
    ) => {
      browserService?.setBounds(
        String(taskId),
        bounds as {
          x: number;
          y: number;
          width: number;
          height: number;
        } | null,
      );
      return { ok: true };
    },
  );
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:browser:setVisible",
    gate,
    (_e, taskId: unknown, visible: unknown) => {
      browserService?.setVisible(String(taskId), Boolean(visible));
      return { ok: true };
    },
  );

  // Desktop computer-use permissions + machine settings (main-owned probes)
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:desktop:permissions",
    gate,
    async () => {
      await desktopUseService?.refreshPermissions();
      return {
        permissions: desktopPolicyStore?.getPermissions() ?? null,
        machine: desktopPolicyStore?.getMachine() ?? null,
      };
    },
  );
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:desktop:openCaptureSettings",
    gate,
    async () => {
      const adapter = createDesktopAdapter();
      await adapter.openCaptureSettings();
      return { ok: true };
    },
  );
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:desktop:openInputSettings",
    gate,
    async () => {
      const adapter = createDesktopAdapter();
      await adapter.openInputSettings();
      return { ok: true };
    },
  );
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:desktop:setMachine",
    gate,
    async (_e, partial: unknown) => {
      if (!desktopPolicyStore) return { ok: false };
      const next = desktopPolicyStore.setMachine(
        partial as Partial<import("@grokdesk/shared").DesktopMachineSettings>,
      );
      // Persist via gateway settings when available
      if (gateway) {
        try {
          await gateway.request("settings.set", {
            desktopControl: next,
          });
        } catch {
          /* ignore */
        }
      }
      return { ok: true, machine: next };
    },
  );
  registerPrivilegedHandle(
    ipcMain,
    "grokdesk:desktop:setGlobalPaused",
    gate,
    (_e, paused: unknown) => {
      desktopPolicyStore?.setGlobalPaused(Boolean(paused));
      return { ok: true };
    },
  );

  // Free Desk: no product-license gate. Optional runtime security/admission pause only.
  registerDictationIpc({
    assertSender: gate,
    entitlementGate: dictationGateFromStatus(
      async () => ({ state: "active" }),
      () =>
        updateBootstrap?.getGrokOperationReadiness() ?? {
          ready: true,
          reason: "ready",
        },
    ),
  });

  // Task 18: E2E-only crash/fault controls (no-op unless GROKDESK_E2E=1).
  registerE2eTestControls({
    ipcMain,
    assertSender: gate,
    gateway: {
      crashForTest: () => gateway?.crashForTest?.(),
      restart: () => gateway?.restart(),
    },
  });
}

app.whenReady().then(async () => {
  initMainLog(app.getPath("userData"));
  mainLog("info", "app ready");

  // Microphone for voice dictation (Grok STT). Deny other permission types by default.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      if (permission === "media") {
        callback(true);
        return;
      }
      callback(false);
    },
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === "media";
  });

  registerAssetProtocolHandler(protocol);

  const browserPolicy = new BrowserPolicyStore();
  browserPolicyStore = browserPolicy;
  browserService = new BrowserService(
    () => mainWindow,
    (taskId, url) =>
      browserPolicy.authorize(taskId, "browser_open", { url }),
    (taskId, url) => browserPolicy.revalidateLocal(taskId, url),
  );

  desktopPolicyStore = new DesktopPolicyStore();
  const desktopAdapter = createDesktopAdapter();
  desktopUseService = new DesktopUseService(desktopPolicyStore, desktopAdapter);
  void desktopUseService.refreshPermissions();

  browserPolicyStore.setApprovalHandler(async (req) => {
    if (gateway) {
      await gateway.request("browser.hostApproval", {
        approvalId: req.approvalId,
        taskId: req.taskId,
        tool: req.tool,
        reason: req.reason,
        url: req.url,
        args: req.args,
      });
    }
    mainWindow?.webContents.send("grokdesk:browser:approval", req);
    notifyNeedsYou("Grok Desk", "Browser action needs your approval");
  });

  browserService.onStatus((s) => {
    mainWindow?.webContents.send("grokdesk:browser:status", s);
  });

  desktopUseService.onStatus((s) => {
    mainWindow?.webContents.send("grokdesk:desktop:status", s);
  });

  const host = await startBrowserHostServer(browserService, browserPolicyStore);
  browserHostClose = host.close;
  process.env.GROKDESK_BROWSER_URL = host.url;
  process.env.GROKDESK_BROWSER_TOKEN = host.token;
  process.env.GROKDESK_BROWSER_MCP_PATH = resolveBrowserMcpPath();

  const deskHost = await startDesktopHostServer(
    desktopUseService,
    desktopPolicyStore,
  );
  desktopHostClose = deskHost.close;
  process.env.GROKDESK_DESKTOP_URL = deskHost.url;
  process.env.GROKDESK_DESKTOP_TOKEN = deskHost.token;
  process.env.GROKDESK_DESKTOP_MCP_PATH = resolveDesktopMcpPath();

  // Free Desk: no product-license bootstrap. Stale entitlement state files under
  // userData are ignored and never crash startup. Gateway product-license
  // fail-closed is always off; managed-runtime readiness is still enforced.
  const bakedEntitlementApi = bakedValue(__GROKDESK_ENTITLEMENT_API_URL__);
  const bakedManifestUrl = bakedValue(__GROKDESK_MANIFEST_URL__);
  const entitlementApiBase = app.isPackaged
    ? bakedEntitlementApi || DEFAULT_ENTITLEMENT_API_URL
    : process.env.GROKDESK_ENTITLEMENT_API_URL?.trim() ||
      bakedEntitlementApi ||
      DEFAULT_ENTITLEMENT_API_URL;
  if (app.isPackaged) {
    if (bakedManifestUrl) {
      process.env.GROKDESK_MANIFEST_URL = bakedManifestUrl;
    } else {
      delete process.env.GROKDESK_MANIFEST_URL;
    }
  } else if (!process.env.GROKDESK_MANIFEST_URL?.trim() && bakedManifestUrl) {
    process.env.GROKDESK_MANIFEST_URL = bakedManifestUrl;
  }
  // Open Grok admission (no Desk product key). DEV_UNLOCK still helps local CLI discovery.
  process.env.GROKDESK_ENTITLEMENT_FAIL_CLOSED = "0";
  process.env.GROKDESK_DEV_UNLOCK = "1";
  mainLog("info", "free Desk: product-license enforcement disabled");

  // Managed Grok runtime recovery + update coordinator before gateway so the
  // child inherits GROKDESK_MANAGED_GROK_BINARY when a complete install exists.
  // Production resolve/stage adapters wire when release keys + manifest URL
  // are available. Missing runtime/update readiness remains fail-closed.
  // rebuildGateway closes over module `gateway` (assigned after bootstrap).
  try {
    updateBootstrap = createUpdateBootstrap({
      userDataDir: app.getPath("userData"),
      deskVersion: app.getVersion(),
      isIdle: () => isUpdateIdleTrayStatus(lastTrayStatus),
      entitlementApiBase,
      entitlementClient: undefined,
      isPackaged: app.isPackaged,
      rebuildGateway: createRebuildGatewayHandler({
        // Gateway is created after bootstrap; switch happens later when ready.
        getGateway: () => gateway,
        onLog: (message, detail) => mainLog("info", message, detail),
      }),
      health: createGatewayUpdateHealth(() => gateway),
      getDeviceCohortId: async () => "anonymous",
      getActivationId: async () => null,
      onError: (err, context) => {
        mainLog(
          "warn",
          `update ${context}`,
          err instanceof Error ? err.message : String(err),
        );
      },
      onStatus: (status) => {
        try {
          const safe = toSafeUpdateStatus(status);
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(UPDATE_MAIN_IPC_CHANNELS.statusChanged, safe);
          }
        } catch (err) {
          mainLog(
            "warn",
            "update status push skipped (unsafe or invalid)",
            err instanceof Error ? err.message : String(err),
          );
        }
      },
    });
    registerUpdateIpc(
      ipcMain,
      createUpdateIpcHandlers({
        getCoordinator: () => updateBootstrap?.coordinator ?? null,
      }),
      (event) => {
        assertPrivilegedIpcSender(
          event as { sender: Electron.WebContents },
        );
      },
    );
    const managed = updateBootstrap.getManagedBinaryPath();
    if (managed) {
      mainLog("info", "managed grok binary ready", managed);
    } else {
      mainLog(
        "warn",
        "managed grok binary unavailable; Grok admission blocked",
        updateBootstrap.recoveryNotes.join(",") || "no_complete_install",
      );
    }
    if (updateBootstrap.productionAdapters) {
      mainLog("info", "production update adapters ready");
    } else {
      mainLog(
        "warn",
        "production update adapters unavailable; Grok admission blocked",
      );
    }
  } catch (err) {
    mainLog(
      "warn",
      "update/runtime bootstrap failed; Grok admission remains blocked",
      err instanceof Error ? err.message : String(err),
    );
    updateBootstrap = null;
    // Still register handlers so renderer gets safe idle / not_ready.
    registerUpdateIpc(
      ipcMain,
      createUpdateIpcHandlers({ getCoordinator: () => null }),
      (event) => {
        assertPrivilegedIpcSender(
          event as { sender: Electron.WebContents },
        );
      },
    );
  }

  gateway = new GatewayProcess({
    managedBinaryPath: updateBootstrap?.getManagedBinaryPath() ?? null,
  });
  gateway.setHostHandler(async (method, params) => {
    if (!browserService || !browserPolicyStore) {
      throw new Error("BrowserService not ready");
    }
    if (method === "browser.configure") {
      const taskId = String(params.taskId ?? "");
      if (!taskId) throw new Error("taskId required");
      browserPolicyStore.configure(taskId, params.policy as PolicySnapshot);
      return { ok: true, taskId };
    }
    if (method === "browser.rememberOrigin") {
      browserPolicyStore.rememberOrigin(
        String(params.taskId ?? ""),
        String(params.url ?? ""),
      );
      return { ok: true };
    }
    if (method === "browser.resolveApproval") {
      return browserPolicyStore.resolveApproval(
        String(params.approvalId ?? ""),
        params.decision === "reject" ? "reject" : "approve",
      );
    }
    if (method === "browser.exec") {
      const taskId = String(params.taskId ?? "");
      const tool = String(params.tool ?? "");
      const args = (params.args as Record<string, unknown>) ?? {};
      const source =
        params.source === "renderer_user" ? "renderer_user" : "agent";
      const authz = await browserPolicyStore.authorize(taskId, tool, args, {
        source,
      });
      if (!authz.ok) return authz;
      const execArgs = authz.canonicalUrl
        ? { ...args, url: authz.canonicalUrl, path: authz.canonicalUrl }
        : args;
      return browserService.exec(taskId, tool, execArgs, authz);
    }
    if (method === "browser.destroy") {
      const taskId = String(params.taskId ?? "");
      browserPolicyStore.cancelTask(taskId);
      await browserService.destroy(taskId);
      browserPolicyStore.delete(taskId);
      return { ok: true, taskId };
    }

    // Desktop computer-use
    if (!desktopPolicyStore || !desktopUseService) {
      throw new Error("DesktopUseService not ready");
    }
    if (method === "desktop.configure") {
      const taskId = String(params.taskId ?? "");
      desktopPolicyStore.configure({
        taskId,
        granted: Boolean(params.granted),
        displayId:
          params.displayId === undefined
            ? undefined
            : (params.displayId as string | null),
        machine: params.machine as import("@grokdesk/shared").DesktopMachineSettings,
        clearSoftPause: Boolean(params.clearSoftPause),
      });
      return { ok: true, taskId };
    }
    if (method === "desktop.exec") {
      const taskId = String(params.taskId ?? "");
      const tool = String(params.tool ?? "");
      const args = (params.args as Record<string, unknown>) ?? {};
      return desktopUseService.exec(taskId, tool, args);
    }
    if (method === "desktop.destroy") {
      const taskId = String(params.taskId ?? "");
      desktopUseService.destroy(taskId);
      return { ok: true, taskId };
    }
    if (method === "desktop.status") {
      const taskId = String(params.taskId ?? "");
      const st = desktopPolicyStore.getTaskState(taskId);
      if (!st) return null;
      return {
        taskId,
        active: false,
        exclusive: false,
        softPaused: st.softPaused,
        lastAction: null,
        lastError: null,
        lastScreenshotDataUrl: null,
        frontmostApp: null,
        displayId: st.displayId,
        updatedAt: new Date().toISOString(),
      };
    }
    if (method === "desktop.permissions") {
      await desktopUseService.refreshPermissions();
      return desktopPolicyStore.getPermissions();
    }
    throw new Error(`Unknown host method ${method}`);
  });

  gateway.onStatus((s) => pushGatewayStatus(s));
  gateway.onNotify((method, params) => pushGatewayNotify(method, params));
  try {
    await gateway.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mainLog("error", "gateway failed to start", message);
    await dialog.showMessageBox({
      type: "error",
      title: mt("dialogStartFailed"),
      message: "The local gateway could not start.",
      detail: message,
      buttons: ["OK"],
    });
    app.quit();
    return;
  }

  // Sleep/wake: pause scheduler on suspend; refresh auth before wake dispatch.
  wirePowerMonitor((state) => {
    void gateway?.request("power.setState", { state }).catch((err) => {
      mainLog(
        "warn",
        "power.setState failed",
        err instanceof Error ? err.message : String(err),
      );
    });
  });

  // Journal recovery + first update check (non-blocking schedule after start).
  if (updateBootstrap) {
    void updateBootstrap.start().catch((err) => {
      mainLog(
        "warn",
        "update scheduler start failed",
        err instanceof Error ? err.message : String(err),
      );
    });
  }

  registerIpc(gateway, {
    onPauseAll: (paused) => {
      desktopPolicyStore?.setGlobalPaused(paused);
    },
    getMainWindow: () => mainWindow,
  });
  registerDesktopIpc();

  // Hydrate machine desktop settings from gateway so Permissions tab matches disk.
  try {
    const s = (await gateway.request("settings.get", {})) as {
      desktopControl?: import("@grokdesk/shared").DesktopMachineSettings;
    };
    if (s?.desktopControl && desktopPolicyStore) {
      desktopPolicyStore.setMachine(s.desktopControl);
    }
  } catch {
    /* non-fatal */
  }

  createAppTray({
    gateway,
    getMainWindow: () => mainWindow,
  });

  setInterval(() => {
    void (async () => {
      if (!gateway) return;
      try {
        const s = (await gateway.request("tray.status", {})) as {
          status: string;
          notificationTitle?: string | null;
          needsInput?: boolean;
        };
        if (s.status === "needs_you" && lastTrayStatus !== "needs_you") {
          const body =
            typeof s.notificationTitle === "string" &&
            s.notificationTitle.trim()
              ? s.notificationTitle.trim()
              : "A task is waiting for your approval";
          notifyNeedsYou("Grok Desk", body);
        }
        lastTrayStatus = s.status;
      } catch {
        // ignore while reconnecting
      }
    })();
  }, 2500).unref?.();

  await createWindow();
  pushGatewayStatus(gateway.getStatus());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitDraining = false;

app.on("before-quit", (e) => {
  if (!quitDraining) {
    // One-time synchronous teardown of IPC + bootstraps.
    unregisterIpc();
    unregisterUpdateIpc(ipcMain);
    try {
      updateBootstrap?.stop();
    } catch {
      // ignore
    }
    updateBootstrap = null;
    ipcMain.removeHandler("grokdesk:pickDirectory");
    ipcMain.removeHandler("grokdesk:pickFiles");
    ipcMain.removeHandler("grokdesk:writeTempAttachment");
    ipcMain.removeHandler("grokdesk:reveal");
    ipcMain.removeHandler("grokdesk:gatewayStatus");
    ipcMain.removeHandler("grokdesk:restartGateway");
    ipcMain.removeHandler("grokdesk:openLogs");
    ipcMain.removeHandler("grokdesk:copyDiagnostics");
    ipcMain.removeHandler("grokdesk:browser:status");
    ipcMain.removeHandler("grokdesk:browser:setBounds");
    ipcMain.removeHandler("grokdesk:browser:setVisible");
    ipcMain.removeHandler("grokdesk:desktop:permissions");
    ipcMain.removeHandler("grokdesk:desktop:openCaptureSettings");
    ipcMain.removeHandler("grokdesk:desktop:openInputSettings");
    ipcMain.removeHandler("grokdesk:desktop:setMachine");
    ipcMain.removeHandler("grokdesk:desktop:setGlobalPaused");
    unregisterE2eTestControls(ipcMain);
    void browserHostClose?.();
    void desktopHostClose?.();
  }

  // The gateway owns a non-detached child process (which owns Grok CLI
  // grandchildren). Firing `stop()` and returning let Electron exit before the
  // async teardown finished, orphaning those processes. Block the quit just
  // long enough to drain — force-killing on timeout — then really quit. The
  // guard makes the drain run once and lets the re-dispatched quit proceed.
  const g = gateway;
  if (g && !quitDraining) {
    e.preventDefault();
    quitDraining = true;
    gateway = null;
    void g
      .shutdownForQuit(3_000)
      .catch(() => {
        // ignore — we quit regardless
      })
      .finally(() => {
        app.quit();
      });
  }
});
