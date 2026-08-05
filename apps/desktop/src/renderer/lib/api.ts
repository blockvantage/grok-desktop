import type {
  AuditEntry,
  PrivacyState,
  UpdateActionResult,
  UpdateStatus,
  UsageSnapshot,
} from "@grokdesk/shared";

type RpcOk<T> = { ok: true; result: T };
type RpcErr = { ok: false; error: string };

export type BrowserStatusDto = {
  taskId: string;
  url: string;
  title: string;
  loading: boolean;
  error: string | null;
  active: boolean;
  lastAction: string | null;
};

/** Preload update bridge (status/check/install/cancel only; no policy/grants). */
export type GrokdeskUpdateBridge = {
  status: () => Promise<UpdateStatus>;
  check: () => Promise<UpdateActionResult>;
  installRestart: () => Promise<UpdateActionResult>;
  cancel: () => Promise<UpdateActionResult>;
  onStatusChanged?: (cb: (s: UpdateStatus) => void) => () => void;
};

declare global {
  interface Window {
    grokdesk: {
      request: (payload: unknown) => Promise<RpcOk<unknown> | RpcErr>;
      pickDirectory: () => Promise<string | null>;
      pickFiles?: () => Promise<string[]>;
      writeTempAttachment?: (payload: {
        name: string;
        base64: string;
      }) => Promise<{ ok: boolean; path?: string; error?: string }>;
      reveal: (
        filePath: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>;
      gatewayStatus?: () => Promise<string>;
      restartGateway?: () => Promise<{
        ok: boolean;
        status?: string;
        error?: string;
      }>;
      openLogs?: () => Promise<{ ok: boolean; path?: string }>;
      copyDiagnostics?: () => Promise<{ ok: boolean; text?: string }>;
      onGatewayStatus?: (cb: (status: string) => void) => () => void;
      onGatewayNotify?: (
        cb: (msg: { method: string; params: Record<string, unknown> }) => void,
      ) => () => void;
      onNavigate?: (
        cb: (target: { nav?: string; settingsTab?: string }) => void,
      ) => () => void;
      /** Main-process locale (tray + native dialogs). */
      app?: {
        setLocale?: (locale: string) => Promise<{ ok: boolean }>;
      };
      update?: GrokdeskUpdateBridge;
      browser?: {
        getStatus: (taskId: string) => Promise<BrowserStatusDto | null>;
        setBounds: (
          taskId: string,
          bounds: {
            x: number;
            y: number;
            width: number;
            height: number;
          } | null,
        ) => Promise<{ ok: boolean }>;
        setVisible: (
          taskId: string,
          visible: boolean,
        ) => Promise<{ ok: boolean }>;
        onStatus: (cb: (s: BrowserStatusDto) => void) => () => void;
      };
      desktop?: {
        getPermissions: () => Promise<unknown>;
        openCaptureSettings: () => Promise<unknown>;
        openInputSettings: () => Promise<unknown>;
        setMachine: (partial: Record<string, unknown>) => Promise<unknown>;
        setGlobalPaused: (paused: boolean) => Promise<unknown>;
        onStatus: (cb: (s: unknown) => void) => () => void;
      };
      dictation?: {
        start: (opts?: { language?: string }) => Promise<{
          ok: boolean;
          error?: string;
          mode?: string;
          sampleRate?: number;
        }>;
        stop: () => Promise<{
          ok: boolean;
          text?: string;
          error?: string;
          mode?: string;
        }>;
        pushPartial?: (text: string) => Promise<{ ok: boolean }>;
        pushPcm?: (
          chunk: ArrayBuffer | Uint8Array | number[],
        ) => Promise<{ ok: boolean }>;
        getState?: () => Promise<unknown>;
        onPartial: (cb: (p: { text: string }) => void) => () => void;
        onState: (
          cb: (s: { state: string; message?: string; mode?: string }) => void,
        ) => () => void;
      };
    };
  }
}

export type GatewayUiStatus =
  | "idle"
  | "starting"
  | "ready"
  | "restarting"
  | "dead";

export async function getGatewayStatus(): Promise<GatewayUiStatus> {
  if (!window.grokdesk?.gatewayStatus) return "ready";
  const s = await window.grokdesk.gatewayStatus();
  return s as GatewayUiStatus;
}

export function subscribeGatewayStatus(
  cb: (status: GatewayUiStatus) => void,
): () => void {
  if (!window.grokdesk?.onGatewayStatus) return () => {};
  return window.grokdesk.onGatewayStatus((s) => cb(s as GatewayUiStatus));
}

export type GatewayNotifyDto = {
  method: string;
  params: Record<string, unknown>;
};

/** Server-push from the gateway child (tasks/events/inbox/remote). */
export function subscribeGatewayNotify(
  cb: (msg: GatewayNotifyDto) => void,
): () => void {
  if (!window.grokdesk?.onGatewayNotify) return () => {};
  return window.grokdesk.onGatewayNotify(cb);
}

export function subscribeNavigate(
  cb: (target: { nav?: string; settingsTab?: string }) => void,
): () => void {
  if (!window.grokdesk?.onNavigate) return () => {};
  return window.grokdesk.onNavigate(cb);
}

export async function openLogsFolder(): Promise<boolean> {
  if (!window.grokdesk?.openLogs) return false;
  const r = await window.grokdesk.openLogs();
  return Boolean(r.ok);
}

export async function copyDiagnostics(): Promise<boolean> {
  if (!window.grokdesk?.copyDiagnostics) return false;
  const r = await window.grokdesk.copyDiagnostics();
  return Boolean(r.ok);
}

/** Explicit engine recovery — sender-gated via main process. */
export async function restartGateway(): Promise<{
  ok: boolean;
  status?: string;
  error?: string;
}> {
  if (!window.grokdesk?.restartGateway) {
    return { ok: false, error: "restart_unavailable" };
  }
  return window.grokdesk.restartGateway();
}

let reqCounter = 0;

export async function rpc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (typeof window === "undefined" || !window.grokdesk?.request) {
    throw new Error("grokdesk IPC bridge is not available");
  }
  const id = String(++reqCounter);
  const res = await window.grokdesk.request({ id, method, params });
  if (!res.ok) throw new Error(res.error);
  return res.result as T;
}

export type ListAuditParams = {
  taskId?: string;
  decision?: AuditEntry["decision"];
  limit?: number;
};

/** Honest audit list page — hasMore/total make truncation visible to Settings/task UI. */
export type ListAuditResult = {
  entries: AuditEntry[];
  hasMore: boolean;
  total: number;
  limit: number;
};

/**
 * Newest-first audit page (optional taskId / decision filter; limit default 100, max 500).
 * Single client surface — use `audit.list` alias for namespace-style access.
 */
export async function listAudit(
  params: ListAuditParams = {},
): Promise<ListAuditResult> {
  return rpc<ListAuditResult>("audit.list", { ...params });
}

export async function pickDirectory(): Promise<string | null> {
  if (!window.grokdesk?.pickDirectory) return null;
  return window.grokdesk.pickDirectory();
}

export async function pickFiles(): Promise<string[]> {
  if (!window.grokdesk?.pickFiles) return [];
  return window.grokdesk.pickFiles();
}

export async function writeTempAttachment(
  name: string,
  base64: string,
): Promise<string | null> {
  const r = await window.grokdesk?.writeTempAttachment?.({ name, base64 });
  return r?.ok && r.path ? r.path : null;
}

export type RevealResult = {
  ok: boolean;
  path?: string;
  error?: string;
};

/**
 * Reveal a file in Finder/Explorer, or open a folder.
 * Returns a result so the UI can toast failures (e.g. cleaned temp workspaces).
 */
export async function revealPath(filePath: string): Promise<RevealResult> {
  if (!window.grokdesk?.reveal) {
    return { ok: false, error: "Reveal is not available" };
  }
  const res = (await window.grokdesk.reveal(filePath)) as RevealResult;
  return res ?? { ok: false, error: "Reveal failed" };
}

export async function browserSetBounds(
  taskId: string,
  bounds: { x: number; y: number; width: number; height: number } | null,
): Promise<void> {
  await window.grokdesk?.browser?.setBounds(taskId, bounds);
}

export async function browserSetVisible(
  taskId: string,
  visible: boolean,
): Promise<void> {
  await window.grokdesk?.browser?.setVisible(taskId, visible);
}

export function browserOnStatus(
  cb: (s: BrowserStatusDto) => void,
): () => void {
  return window.grokdesk?.browser?.onStatus(cb) ?? (() => {});
}

export async function browserGetStatus(
  taskId: string,
): Promise<BrowserStatusDto | null> {
  return (await window.grokdesk?.browser?.getStatus(taskId)) ?? null;
}

/** Rename a chat (sets the root task's short title). */
export async function renameTask(taskId: string, title: string): Promise<void> {
  await rpc("tasks.setTitle", { taskId, title });
}

/**
 * Mid-run nudge (ACP interjection). Returns delivered=false when unsupported.
 * Pass clientMutationId so gateway mutation receipts dedupe reload replays.
 */
export async function taskInterject(
  taskId: string,
  text: string,
  clientMutationId?: string,
): Promise<{ delivered: boolean }> {
  return rpc<{ delivered: boolean }>("task.interject", {
    taskId,
    text,
    ...(clientMutationId ? { clientMutationId } : {}),
  });
}

/** Context usage for the context meter (null when unknown). */
export async function taskContextUsage(taskId: string): Promise<{
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
} | null> {
  return rpc("task.contextUsage", { taskId });
}

/** Compact conversation (ACP). */
export async function taskCompact(
  taskId: string,
): Promise<{ ok: boolean }> {
  return rpc<{ ok: boolean }>("task.compact", { taskId });
}

/** Rewind points (null when unsupported / headless). */
export async function taskRewindPoints(taskId: string): Promise<Array<{
  id: string;
  label?: string;
  files?: string[];
  hasFileChanges?: boolean;
}> | null> {
  return rpc("task.rewindPoints", { taskId });
}

/** Execute rewind to a point (and mark turnId + later turns superseded). */
export async function taskRewind(
  taskId: string,
  pointId: string,
  turnId?: string,
): Promise<{ ok: boolean }> {
  return rpc<{ ok: boolean }>("task.rewind", {
    taskId,
    pointId,
    ...(turnId ? { turnId } : {}),
  });
}

/** Delete a whole chat thread (root + follow-ups) and its app-managed files. */
export async function deleteTask(
  taskId: string,
): Promise<{ ok: boolean; deletedIds: string[] }> {
  return rpc<{ ok: boolean; deletedIds: string[] }>("tasks.delete", { taskId });
}

/** Namespace-style access used by audit drawer / Settings deep links. */
export const audit = {
  list: listAudit,
};

/** SuperGrok usage (main process; no tokens in result). */
export async function getUsage(force = false): Promise<UsageSnapshot> {
  return rpc<UsageSnapshot>("auth.usage", { force });
}

export async function openBilling(): Promise<{ opened: boolean }> {
  return rpc<{ opened: boolean }>("auth.openBilling", {});
}

/** Open SuperGrok/xAI account privacy & data controls (self-serve). */
export async function openAccountPrivacy(): Promise<{ opened: boolean }> {
  return rpc<{ opened: boolean }>("auth.openAccountPrivacy", {});
}

export async function getPrivacy(): Promise<PrivacyState> {
  return rpc<PrivacyState>("auth.privacy.get", {});
}

export async function exportChatMarkdown(
  taskId: string,
): Promise<{ path: string; markdown: string }> {
  return rpc<{ path: string; markdown: string }>("chats.exportMarkdown", {
    taskId,
  });
}

export type WorkspaceAsset = {
  path: string;
  name: string;
  mime: string;
  size: number;
  /**
   * Tokenized custom-protocol URL served by main (preferred for large/video).
   * Always set when prepare/read succeeds through the desktop shell.
   */
  url: string;
  /**
   * Optional small-image data URL fallback. Large/video assets omit a real
   * data URL and may set this equal to `url` for legacy callers.
   */
  dataUrl?: string;
};

/**
 * Display source for an asset.
 * Prefer a real data URL when present (most reliable in the renderer); fall
 * back to the custom-protocol URL for large video that was not inlined.
 */
export function assetDisplaySrc(asset: WorkspaceAsset): string {
  if (asset.dataUrl && asset.dataUrl.startsWith("data:")) return asset.dataUrl;
  return asset.url || asset.dataUrl || "";
}

/**
 * Load workspace media for preview. Uses main-process tokenized protocol URLs
 * so large images/videos are not base64'd over gateway JSON-lines.
 */
export async function readAsset(
  path: string,
  opts?: { root?: string | null },
): Promise<WorkspaceAsset> {
  // prepareAsset is intercepted in main to mint grokdesk-asset:// URLs.
  return rpc<WorkspaceAsset>("workspace.prepareAsset", {
    path,
    ...(opts?.root ? { root: opts.root } : {}),
  });
}

/** Extensions the asset bridge can inline as images. */
export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "ico",
];

export function isImagePath(p: string | null | undefined): boolean {
  if (!p) return false;
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

/** Extensions the asset bridge can inline as <video> playback. */
export const VIDEO_EXTENSIONS = ["mp4", "m4v", "webm", "ogv", "mov"];

export function isVideoPath(p: string | null | undefined): boolean {
  if (!p) return false;
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.includes(ext);
}

/** Extensions the asset bridge can inline as <audio> playback. */
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];

export function isAudioPath(p: string | null | undefined): boolean {
  if (!p) return false;
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.includes(ext);
}

/** True for any media (image, video, or audio) we can embed inline. */
export function isMediaPath(p: string | null | undefined): boolean {
  return isImagePath(p) || isVideoPath(p) || isAudioPath(p);
}

// Re-export path for @/lib/api consumers
export type { };
