import { ipcMain, shell } from "electron";
import type { GatewayProcess } from "./gateway-process";
import {
  assetTokenStore,
  assertServableAsset,
  prefersInlineDataUrl,
  INLINE_DATA_URL_MAX_BYTES,
} from "./asset-protocol";
import {
  ACCOUNT_PRIVACY_URL,
  BILLING_MANAGE_URL,
  clearUsageCache,
  getPrivacyState,
  getUsageForUi,
  setPrivacyState,
} from "./super-grok-http";
import { decideExternalUrl } from "./security-url";
import { validatePrivilegedIpcSender } from "./ipc-sender";
import { gatewayMethodTimeoutMs } from "./ipc-method-timeouts";
import type { BrowserWindow } from "electron";

type PreparedMeta = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

/**
 * Mint a protocol URL for gateway-validated media metadata.
 * Optionally attach a small dataUrl for images under the inline threshold.
 */
async function enrichPreparedAsset(
  gateway: GatewayProcess,
  meta: PreparedMeta,
  params: Record<string, unknown>,
): Promise<
  PreparedMeta & { url: string; dataUrl?: string }
> {
  assertServableAsset({
    absPath: meta.path,
    mime: meta.mime,
    size: meta.size,
  });
  const token = assetTokenStore.mint({
    absPath: meta.path,
    mime: meta.mime,
    size: meta.size,
  });
  const url = assetTokenStore.buildUrl(token);
  const out: PreparedMeta & { url: string; dataUrl?: string } = {
    ...meta,
    url,
  };

  if (prefersInlineDataUrl(meta.mime, meta.size)) {
    try {
      // Cap matches prefersInlineDataUrl thresholds (images up to 8MB, short video).
      const maxBytes = Math.max(meta.size, INLINE_DATA_URL_MAX_BYTES);
      const inline = (await gateway.request("workspace.readAsset", {
        path: meta.path,
        maxBytes: Math.min(maxBytes + 1024, 32 * 1024 * 1024),
        ...(typeof params.root === "string" ? { root: params.root } : {}),
      })) as { dataUrl?: string };
      if (inline?.dataUrl) out.dataUrl = inline.dataUrl;
    } catch {
      // URL-only is fine if inline fails
    }
  }
  return out;
}

function assertIpcSender(
  evt: Electron.IpcMainInvokeEvent,
  getMainWindow: (() => BrowserWindow | null) | undefined,
): void {
  if (!getMainWindow) return;
  const mainWindow = getMainWindow();
  const check = validatePrivilegedIpcSender({
    sender: evt.sender,
    mainWindow,
    trustedDevOrigin: process.env.ELECTRON_RENDERER_URL ?? null,
  });
  if (!check.ok) {
    throw new Error(`IPC sender rejected: ${check.reason}`);
  }
}

export function registerIpc(
  gateway: GatewayProcess,
  opts?: {
    onPauseAll?: (paused: boolean) => void;
    getMainWindow?: () => BrowserWindow | null;
  },
): void {
  ipcMain.handle("grokdesk:request", async (evt, raw: unknown) => {
    // Parse outside try so catch can clear usage on auth.signOut without
    // referencing a block-scoped binding (TS2304).
    const req = raw as {
      method?: string;
      params?: Record<string, unknown>;
      id?: string;
    };
    const method = typeof req?.method === "string" ? req.method : "";
    const params = (req?.params as Record<string, unknown>) ?? {};
    const isSignOut = method === "auth.signOut";

    try {
      assertIpcSender(evt, opts?.getMainWindow);
      if (!method) {
        throw new Error("IPC request missing method");
      }

      // Mirror pause into desktop policy (main process).
      if (method === "tasks.pauseAll") {
        opts?.onPauseAll?.(true);
      }
      if (method === "tasks.resumeAll") {
        opts?.onPauseAll?.(false);
      }

      // SuperGrok rails (tokens stay in main — never forwarded to renderer).
      if (method === "auth.usage") {
        const snap = await getUsageForUi(Boolean(params.force));
        return { ok: true, result: snap };
      }
      if (method === "auth.openBilling") {
        const d = decideExternalUrl(BILLING_MANAGE_URL);
        if (d.allowed) await shell.openExternal(d.url);
        return { ok: true, result: { opened: d.allowed } };
      }
      if (method === "auth.openAccountPrivacy") {
        // SuperGrok privacy/data controls live on xAI (self-serve).
        const d = decideExternalUrl(ACCOUNT_PRIVACY_URL);
        if (d.allowed) await shell.openExternal(d.url);
        return { ok: true, result: { opened: d.allowed } };
      }
      if (method === "auth.privacy.get") {
        const privacy = await getPrivacyState();
        return { ok: true, result: privacy };
      }
      if (method === "auth.privacy.set") {
        // No-op by design — Desk does not own SuperGrok privacy settings.
        const privacy = await setPrivacyState(Boolean(params.codingDataSharing));
        return { ok: true, result: privacy };
      }

      // Tokenized media: gateway validates path/mime/size; main serves bytes.
      if (method === "workspace.prepareAsset") {
        const meta = (await gateway.request(method, params)) as PreparedMeta;
        const result = await enrichPreparedAsset(gateway, meta, params);
        return { ok: true, result };
      }

      // Legacy readAsset: still return dataUrl when small, always attach url.
      if (method === "workspace.readAsset") {
        const meta = (await gateway.request("workspace.prepareAsset", {
          path: params.path,
          ...(typeof params.root === "string" ? { root: params.root } : {}),
          maxBytes:
            typeof params.maxBytes === "number"
              ? params.maxBytes
              : 256 * 1024 * 1024,
        })) as PreparedMeta;
        const withUrl = await enrichPreparedAsset(gateway, meta, params);
        // If enrich did not inline (large/video), do not pull multi-MB base64.
        if (withUrl.dataUrl) {
          return { ok: true, result: withUrl };
        }
        return {
          ok: true,
          result: {
            path: withUrl.path,
            name: withUrl.name,
            mime: withUrl.mime,
            size: withUrl.size,
            url: withUrl.url,
            // Empty dataUrl keeps older callers that require the field from breaking.
            dataUrl: withUrl.url,
          },
        };
      }

      const result = await gateway.request(method, params, {
        timeoutMs: gatewayMethodTimeoutMs(method),
      });
      // After sign-out, drop SuperGrok usage cache so Settings/Home never show
      // the previous account's period usage until a fresh sign-in.
      if (isSignOut) {
        clearUsageCache();
      }
      return { ok: true, result };
    } catch (err) {
      // Still clear usage on failed sign-out attempts (partial logout is common).
      if (isSignOut) {
        clearUsageCache();
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function unregisterIpc(): void {
  ipcMain.removeHandler("grokdesk:request");
  assetTokenStore.clear();
}
