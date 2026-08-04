import { Tray, Menu, nativeImage, nativeTheme, app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { GatewayProcess } from "./gateway-process";
import type { GatewayLifecycleStatus } from "./redact";
import { mt, onMainLocaleChange } from "./main-i18n";
import { GROKDESK_REMOTE_UI_ENABLED } from "@grokdesk/shared";

export function trayAssetName(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "tray-icon-light.png" : "tray-icon-dark.png";
}

function resolveTrayImage(): Electron.NativeImage {
  const candidates = [
    path.join(
      __dirname,
      "../renderer",
      trayAssetName(nativeTheme.shouldUseDarkColors),
    ),
    path.join(__dirname, "../renderer/grok-desk-icon.png"),
    path.join(__dirname, "../renderer/grok-desk-icon-full.png"),
    typeof process.resourcesPath === "string"
      ? path.join(process.resourcesPath, "icon.icns")
      : "",
  ].filter(Boolean);

  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const img = nativeImage.createFromPath(c);
    if (img.isEmpty()) continue;
    return img.resize({ width: 22, height: 22 });
  }

  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  );
}

function engineLabel(status: GatewayLifecycleStatus): string {
  switch (status) {
    case "ready":
      return mt("engineReady");
    case "starting":
      return mt("engineStarting");
    case "restarting":
      return mt("engineReconnecting");
    case "dead":
      return mt("engineStopped");
    case "idle":
    default:
      return mt("engineIdle");
  }
}

export function createAppTray(opts: {
  gateway: GatewayProcess;
  getMainWindow: () => BrowserWindow | null;
}): Tray {
  const tray = new Tray(resolveTrayImage());
  const refreshTrayImage = () => tray.setImage(resolveTrayImage());
  nativeTheme.on("updated", refreshTrayImage);

  const showMain = () => {
    const w = opts.getMainWindow();
    if (w) {
      w.show();
      w.focus();
    }
    return w;
  };

  const buildContextMenu = () => {
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: mt("trayOpen"),
        click: () => {
          showMain();
        },
      },
    ];
    if (GROKDESK_REMOTE_UI_ENABLED) {
      items.push({
        label: mt("trayRemote"),
        click: () => {
          const w = showMain();
          w?.webContents.send("grokdesk:navigate", {
            nav: "settings",
            settingsTab: "remote",
          });
        },
      });
    }
    items.push(
      { type: "separator" },
      {
        label: mt("trayPauseAll"),
        click: () => {
          void opts.gateway.request("tasks.pauseAll", {});
        },
      },
      {
        label: mt("trayResumeAll"),
        click: () => {
          void opts.gateway.request("tasks.resumeAll", {});
        },
      },
    );
    if (GROKDESK_REMOTE_UI_ENABLED) {
      items.push({
        label: mt("trayStopRemote"),
        click: () => {
          void opts.gateway.request("remote.telepresence.stop", {});
        },
      });
    }
    items.push(
      { type: "separator" },
      { label: mt("trayQuit"), click: () => app.quit() },
    );
    return Menu.buildFromTemplate(items);
  };

  tray.setContextMenu(buildContextMenu());

  let lifecycle: GatewayLifecycleStatus = opts.gateway.getStatus();
  let taskHint = "";

  const refreshTooltip = () => {
    const parts = ["Grok Desk", engineLabel(lifecycle)];
    if (taskHint) parts.push(taskHint);
    tray.setToolTip(parts.join(" · "));
  };
  refreshTooltip();

  // LANG-4: rebuild labels when the renderer pushes a new UI locale.
  const offLocale = onMainLocaleChange(() => {
    tray.setContextMenu(buildContextMenu());
    refreshTooltip();
  });

  opts.gateway.onStatus((s) => {
    lifecycle = s;
    if (s === "restarting" || s === "dead" || s === "starting") {
      taskHint = "";
    }
    refreshTooltip();
  });

  const timer = setInterval(() => {
    void (async () => {
      try {
        if (opts.gateway.getStatus() !== "ready") {
          lifecycle = opts.gateway.getStatus();
          refreshTooltip();
          return;
        }
        const s = (await opts.gateway.request("tray.status", {})) as {
          status: string;
          runningCount: number;
        };
        let remoteHint = "";
        try {
          const rs = (await opts.gateway.request("remote.status", {})) as {
            enabled?: boolean;
            relayConnected?: boolean;
            telepresence?: { active?: boolean };
          };
          if (rs.telepresence?.active) {
            remoteHint = "remote control live";
          } else if (rs.enabled && rs.relayConnected) {
            remoteHint = "remote ready";
          } else if (rs.enabled) {
            remoteHint = "remote connecting";
          }
        } catch {
          /* remote may be unavailable */
        }
        const taskPart = s.runningCount
          ? `${s.status} (${s.runningCount})`
          : s.status;
        taskHint = remoteHint ? `${taskPart} · ${remoteHint}` : taskPart;
        lifecycle = "ready";
        refreshTooltip();
      } catch {
        lifecycle = opts.gateway.getStatus();
        refreshTooltip();
      }
    })();
  }, 2000);
  timer.unref?.();

  // Keep listener alive for app lifetime; tray is not destroyed on normal quit path.
  void offLocale;

  return tray;
}
