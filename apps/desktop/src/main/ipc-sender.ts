/**
 * Validate Electron IPC event senders for privileged handlers.
 * Pure enough to unit-test with minimal stubs.
 */

export interface IpcSenderLike {
  id?: number;
  getURL?: () => string;
  isDestroyed?: () => boolean;
}

export interface BrowserWindowLike {
  id: number;
  webContents: IpcSenderLike;
  isDestroyed?: () => boolean;
}

export type SenderValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Privileged IPC must come from a non-destroyed frame owned by the main window
 * (or an allowlisted app window), with a trusted origin when available.
 */
export function validatePrivilegedIpcSender(opts: {
  sender: IpcSenderLike;
  mainWindow: BrowserWindowLike | null;
  /** Dev server origin (e.g. http://localhost:5173) or null for packaged. */
  trustedDevOrigin?: string | null;
  /** Additional allowed window ids (e.g. secondary app windows). */
  allowedWindowIds?: number[];
}): SenderValidation {
  const { sender, mainWindow } = opts;
  if (!sender) {
    return { ok: false, reason: "missing sender" };
  }
  if (sender.isDestroyed?.()) {
    return { ok: false, reason: "destroyed sender" };
  }
  if (!mainWindow || mainWindow.isDestroyed?.()) {
    return { ok: false, reason: "no main window" };
  }

  const mainWc = mainWindow.webContents;
  const senderId = sender.id;
  const mainId = mainWc?.id;
  const allowed = new Set<number>([
    ...(typeof mainId === "number" ? [mainId] : []),
    ...(opts.allowedWindowIds ?? []),
  ]);

  if (typeof senderId === "number" && allowed.size > 0 && !allowed.has(senderId)) {
    // Also accept if sender is exactly main webContents reference equality.
    if (sender !== mainWc) {
      return { ok: false, reason: "sender not owned by app window" };
    }
  }

  const url = safeGetUrl(sender);
  if (url) {
    const mainUrl = safeGetUrl(mainWc);
    const originOk = isTrustedSenderUrl(url, opts.trustedDevOrigin ?? null, {
      mainWindowUrl: mainUrl,
    });
    if (!originOk) {
      return { ok: false, reason: `untrusted sender origin: ${url}` };
    }
    return { ok: true };
  }

  // Fail closed when the frame has no URL unless it is exactly the main
  // webContents (brief load race). Other frames without a URL must not reach
  // privileged handlers.
  if (sender === mainWc) {
    return { ok: true };
  }
  return { ok: false, reason: "missing sender url" };
}

function safeGetUrl(sender: IpcSenderLike): string | null {
  try {
    return sender.getURL?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * Trusted origins for privileged IPC:
 * - file: only when it matches the main window document (or same directory),
 *   so a random file:// page cannot invoke privileged handlers if it somehow
 *   shared a webContents id race.
 * - http(s) only when equal to the configured dev server origin.
 */
export function isTrustedSenderUrl(
  url: string,
  trustedDevOrigin: string | null,
  opts?: { mainWindowUrl?: string | null },
): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") {
      const mainRaw = opts?.mainWindowUrl;
      if (!mainRaw) {
        // Without main context (unit tests / early boot), allow only file:.
        return true;
      }
      try {
        const m = new URL(mainRaw);
        if (m.protocol !== "file:") return false;
        // Identical document (ignore hash/query) or same directory as the app UI.
        const up = decodeURIComponent(u.pathname);
        const mp = decodeURIComponent(m.pathname);
        if (up === mp) return true;
        const uDir = up.replace(/[/\\][^/\\]*$/, "");
        const mDir = mp.replace(/[/\\][^/\\]*$/, "");
        return uDir.length > 0 && uDir === mDir;
      } catch {
        return false;
      }
    }
    if (trustedDevOrigin) {
      const d = new URL(trustedDevOrigin);
      return u.origin === d.origin;
    }
    // Packaged app should not load remote origins into privileged windows.
    return false;
  } catch {
    return false;
  }
}
