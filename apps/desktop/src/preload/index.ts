import { contextBridge, ipcRenderer } from "electron";
// Import the pure channel-name constants from the sandbox-safe leaf entry, NOT
// the barrel: the barrel transitively `require("node:fs")`, which throws in the
// sandboxed preload and prevents the IPC bridge from being exposed.
import { UPDATE_MAIN_IPC_CHANNELS } from "@grokdesk/shared/ipc-channels";

contextBridge.exposeInMainWorld("grokdesk", {
  request: (payload: unknown) => ipcRenderer.invoke("grokdesk:request", payload),
  app: {
    setLocale: (locale: string) =>
      ipcRenderer.invoke("grokdesk:app:setLocale", locale) as Promise<{
        ok: boolean;
      }>,
  },
  pickDirectory: () => ipcRenderer.invoke("grokdesk:pickDirectory"),
  pickFiles: () => ipcRenderer.invoke("grokdesk:pickFiles") as Promise<string[]>,
  writeTempAttachment: (payload: { name: string; base64: string }) =>
    ipcRenderer.invoke("grokdesk:writeTempAttachment", payload) as Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>,
  reveal: (filePath: string) => ipcRenderer.invoke("grokdesk:reveal", filePath),
  gatewayStatus: () =>
    ipcRenderer.invoke("grokdesk:gatewayStatus") as Promise<string>,
  restartGateway: () =>
    ipcRenderer.invoke("grokdesk:restartGateway") as Promise<{
      ok: boolean;
      status?: string;
      error?: string;
    }>,
  openLogs: () =>
    ipcRenderer.invoke("grokdesk:openLogs") as Promise<{
      ok: boolean;
      path?: string;
    }>,
  copyDiagnostics: () =>
    ipcRenderer.invoke("grokdesk:copyDiagnostics") as Promise<{
      ok: boolean;
      text?: string;
    }>,
  /**
   * Task 18 E2E-only channels. Main registers handlers only when
   * GROKDESK_E2E=1; otherwise invoke fails closed.
   */
  e2e: {
    ping: () =>
      ipcRenderer.invoke("grokdesk:e2e:ping") as Promise<{
        ok: boolean;
        e2e?: boolean;
      }>,
    crashGateway: () =>
      ipcRenderer.invoke("grokdesk:e2e:crashGateway") as Promise<{
        ok: boolean;
        error?: string;
      }>,
    injectFault: (kind: string) =>
      ipcRenderer.invoke("grokdesk:e2e:injectFault", kind) as Promise<{
        ok: boolean;
        fault?: string;
        error?: string;
      }>,
    clearFault: () =>
      ipcRenderer.invoke("grokdesk:e2e:clearFault") as Promise<{
        ok: boolean;
        fault?: string;
      }>,
  },
  onGatewayStatus: (cb: (status: string) => void) => {
    const handler = (_: unknown, status: string) => cb(status);
    ipcRenderer.on("grokdesk:gateway-status", handler);
    return () => {
      ipcRenderer.removeListener("grokdesk:gateway-status", handler);
    };
  },
  onGatewayNotify: (
    cb: (msg: { method: string; params: Record<string, unknown> }) => void,
  ) => {
    const handler = (
      _: unknown,
      msg: { method: string; params: Record<string, unknown> },
    ) => cb(msg);
    ipcRenderer.on("grokdesk:gateway-notify", handler);
    return () => {
      ipcRenderer.removeListener("grokdesk:gateway-notify", handler);
    };
  },
  onNavigate: (
    cb: (target: { nav?: string; settingsTab?: string }) => void,
  ) => {
    const handler = (
      _: unknown,
      target: { nav?: string; settingsTab?: string },
    ) => cb(target);
    ipcRenderer.on("grokdesk:navigate", handler);
    return () => {
      ipcRenderer.removeListener("grokdesk:navigate", handler);
    };
  },
  update: {
    status: () => ipcRenderer.invoke(UPDATE_MAIN_IPC_CHANNELS.status),
    check: () => ipcRenderer.invoke(UPDATE_MAIN_IPC_CHANNELS.check),
    installRestart: () =>
      ipcRenderer.invoke(UPDATE_MAIN_IPC_CHANNELS.installRestart),
    cancel: () => ipcRenderer.invoke(UPDATE_MAIN_IPC_CHANNELS.cancel),
    onStatusChanged: (cb: (s: unknown) => void) => {
      const listener = (_: unknown, s: unknown) => cb(s);
      ipcRenderer.on(UPDATE_MAIN_IPC_CHANNELS.statusChanged, listener);
      return () =>
        ipcRenderer.removeListener(
          UPDATE_MAIN_IPC_CHANNELS.statusChanged,
          listener,
        );
    },
  },
  browser: {
    getStatus: (taskId: string) =>
      ipcRenderer.invoke("grokdesk:browser:status", taskId),
    setBounds: (
      taskId: string,
      bounds: { x: number; y: number; width: number; height: number } | null,
    ) => ipcRenderer.invoke("grokdesk:browser:setBounds", taskId, bounds),
    setVisible: (taskId: string, visible: boolean) =>
      ipcRenderer.invoke("grokdesk:browser:setVisible", taskId, visible),
    onStatus: (cb: (s: unknown) => void) => {
      const listener = (_: unknown, s: unknown) => cb(s);
      ipcRenderer.on("grokdesk:browser:status", listener);
      return () =>
        ipcRenderer.removeListener("grokdesk:browser:status", listener);
    },
  },
  desktop: {
    getPermissions: () => ipcRenderer.invoke("grokdesk:desktop:permissions"),
    openCaptureSettings: () =>
      ipcRenderer.invoke("grokdesk:desktop:openCaptureSettings"),
    openInputSettings: () =>
      ipcRenderer.invoke("grokdesk:desktop:openInputSettings"),
    setMachine: (partial: Record<string, unknown>) =>
      ipcRenderer.invoke("grokdesk:desktop:setMachine", partial),
    setGlobalPaused: (paused: boolean) =>
      ipcRenderer.invoke("grokdesk:desktop:setGlobalPaused", paused),
    onStatus: (cb: (s: unknown) => void) => {
      const listener = (_: unknown, s: unknown) => cb(s);
      ipcRenderer.on("grokdesk:desktop:status", listener);
      return () =>
        ipcRenderer.removeListener("grokdesk:desktop:status", listener);
    },
  },
  dictation: {
    start: (opts?: { language?: string }) =>
      ipcRenderer.invoke("grokdesk:dictation:start", opts),
    stop: () => ipcRenderer.invoke("grokdesk:dictation:stop"),
    pushPartial: (text: string) =>
      ipcRenderer.invoke("grokdesk:dictation:pushPartial", text),
    pushPcm: (chunk: ArrayBuffer | Uint8Array | number[]) =>
      ipcRenderer.invoke("grokdesk:dictation:pushPcm", chunk),
    getState: () => ipcRenderer.invoke("grokdesk:dictation:state"),
    onPartial: (cb: (p: { text: string }) => void) => {
      const listener = (_: unknown, p: { text: string }) => cb(p);
      ipcRenderer.on("grokdesk:dictation:partial", listener);
      return () =>
        ipcRenderer.removeListener("grokdesk:dictation:partial", listener);
    },
    onState: (
      cb: (s: { state: string; message?: string }) => void,
    ) => {
      const listener = (
        _: unknown,
        s: { state: string; message?: string },
      ) => cb(s);
      ipcRenderer.on("grokdesk:dictation:state", listener);
      return () =>
        ipcRenderer.removeListener("grokdesk:dictation:state", listener);
    },
  },
});
