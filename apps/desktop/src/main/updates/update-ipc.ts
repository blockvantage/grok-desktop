/**
 * Narrow main-process update IPC.
 *
 * Renderer may call status / check / install-restart / cancel only.
 * Responses are UpdateStatus (shared) — never product keys, device private
 * keys, lease JWTs, download grants, artifact URLs, or internal paths.
 *
 * Security policy is main-only (UpdateCoordinator.applySignedSecurityPolicy);
 * these handlers never expose a set-policy channel.
 */

import {
  UPDATE_MAIN_IPC_CHANNELS,
  idleUpdateStatus,
  parseUpdateStatus,
  type UpdateActionResult,
  type UpdateStatus,
} from "@grokdesk/shared";
import type { UpdateCoordinator } from "./update-coordinator.js";

export { UPDATE_MAIN_IPC_CHANNELS };

/** Paths / keys that must never appear on the wire. */
const FORBIDDEN_PATH_SNIPPETS = [
  "/runtimes/grok/",
  "\\runtimes\\grok\\",
  "/updates/journal",
  "\\updates\\journal",
  "update-journal",
  "staging/",
  "staging\\",
  "privatePkcs8",
  "private_key",
  "privateKey",
  "grantToken",
  "downloadGrant",
  "deviceId",
  "activationId",
  "productKey",
] as const;

/**
 * Canary: fail closed if a status DTO would leak commerce secrets, grants,
 * or private filesystem paths.
 */
export function assertNoUpdateSecrets(
  value: unknown,
  label = "update status",
): void {
  const text = safeJson(value);
  if (/\bGD[123]\./i.test(text)) {
    throw new Error(`${label}: product key must not leave main`);
  }
  if (
    /privatePkcs8|private_key|privateKey|BEGIN (?:ENCRYPTED )?PRIVATE KEY/i.test(
      text,
    )
  ) {
    throw new Error(`${label}: private key material must not leave main`);
  }
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(text)) {
    throw new Error(`${label}: JWT/lease must not leave main`);
  }
  if (
    /grantToken|downloadGrant|canary-download-grant|magicToken|portalToken/i.test(
      text,
    )
  ) {
    throw new Error(`${label}: download grant / token must not leave main`);
  }
  if (/"deviceId"\s*:/.test(text) || /"activationId"\s*:/.test(text)) {
    throw new Error(`${label}: device/activation id must not leave main`);
  }
  // Absolute private paths (managed runtime, journal, staging).
  for (const snip of FORBIDDEN_PATH_SNIPPETS) {
    if (text.includes(snip)) {
      throw new Error(`${label}: private path/key field must not leave main`);
    }
  }
  // Unix/Windows absolute path with runtimes or userData-ish segments.
  if (
    /(?:\/Users\/|\/home\/|[A-Za-z]:\\\\|Application Support|AppData).{0,80}(?:runtimes|updates|staging)/i.test(
      text,
    )
  ) {
    throw new Error(`${label}: absolute runtime/update path must not leave main`);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * Strip coordinator status through the shared schema so only allowed fields
 * reach the renderer. Drops any accidental extra properties.
 */
export function toSafeUpdateStatus(status: UpdateStatus): UpdateStatus {
  const parsed = parseUpdateStatus(status);
  assertNoUpdateSecrets(parsed, "toSafeUpdateStatus");
  return parsed;
}

export type UpdateIpcDeps = {
  /**
   * Live coordinator from createUpdateBootstrap. Null when bootstrap failed
   * or has not run — handlers return a safe idle status.
   */
  getCoordinator: () => UpdateCoordinator | null | undefined;
};

export type UpdateIpcHandlers = {
  status: () => Promise<UpdateStatus>;
  check: () => Promise<UpdateActionResult>;
  installRestart: () => Promise<UpdateActionResult>;
  cancel: () => Promise<UpdateActionResult>;
};

/** Minimal ipcMain surface for registration (avoids hard Electron import in tests). */
export type IpcMainLike = {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ) => void;
  removeHandler: (channel: string) => void;
};

function idleFallback(): UpdateStatus {
  return idleUpdateStatus({
    channel: "stable",
    target: "unsupported",
  });
}

function resultFromCoordinator(
  ok: boolean,
  status: UpdateStatus,
  code?: string,
  message?: string,
): UpdateActionResult {
  const safe = toSafeUpdateStatus(status);
  return ok
    ? { ok: true, status: safe }
    : {
        ok: false,
        status: safe,
        code: code ?? "update_failed",
        message: message ?? "Update action failed",
      };
}

/**
 * Create pure update IPC handlers bound to a coordinator getter.
 */
export function createUpdateIpcHandlers(deps: UpdateIpcDeps): UpdateIpcHandlers {
  async function statusDto(): Promise<UpdateStatus> {
    const coord = deps.getCoordinator();
    if (!coord) {
      return toSafeUpdateStatus(idleFallback());
    }
    return toSafeUpdateStatus(coord.getStatus());
  }

  return {
    status: statusDto,

    async check(): Promise<UpdateActionResult> {
      const coord = deps.getCoordinator();
      if (!coord) {
        return resultFromCoordinator(
          false,
          idleFallback(),
          "not_ready",
          "Update coordinator is not available",
        );
      }
      const r = await coord.checkAndStage();
      return resultFromCoordinator(
        r.ok,
        r.status,
        r.ok ? undefined : r.code,
        r.ok ? undefined : r.message,
      );
    },

    async installRestart(): Promise<UpdateActionResult> {
      const coord = deps.getCoordinator();
      if (!coord) {
        return resultFromCoordinator(
          false,
          idleFallback(),
          "not_ready",
          "Update coordinator is not available",
        );
      }
      const r = await coord.approveRestart("approve_restart");
      return resultFromCoordinator(
        r.ok,
        r.status,
        r.ok ? undefined : r.code,
        r.ok ? undefined : r.message,
      );
    },

    async cancel(): Promise<UpdateActionResult> {
      const coord = deps.getCoordinator();
      if (!coord) {
        return resultFromCoordinator(
          false,
          idleFallback(),
          "not_ready",
          "Update coordinator is not available",
        );
      }
      const r = await coord.approveRestart("cancel");
      return resultFromCoordinator(
        r.ok,
        r.status,
        r.ok ? undefined : r.code,
        r.ok ? undefined : r.message,
      );
    },
  };
}

/**
 * Register handlers on Electron ipcMain (or a test double).
 * `assertSender` is required and fail-closed: missing gate rejects every
 * invoke so installRestart/check cannot run without privileged-sender validation.
 *
 * Never registers applySecurityPolicy or path/grant mutation channels.
 */
export function registerUpdateIpc(
  ipcMain: IpcMainLike,
  handlers: UpdateIpcHandlers,
  assertSender?: (event: unknown) => void,
): void {
  const gate = (event: unknown) => {
    if (typeof assertSender !== "function") {
      throw new Error(
        "IPC sender rejected: update assertSender not configured (fail-closed)",
      );
    }
    assertSender(event);
  };
  ipcMain.handle(UPDATE_MAIN_IPC_CHANNELS.status, async (event) => {
    gate(event);
    return handlers.status();
  });
  ipcMain.handle(UPDATE_MAIN_IPC_CHANNELS.check, async (event) => {
    gate(event);
    return handlers.check();
  });
  ipcMain.handle(UPDATE_MAIN_IPC_CHANNELS.installRestart, async (event) => {
    gate(event);
    return handlers.installRestart();
  });
  ipcMain.handle(UPDATE_MAIN_IPC_CHANNELS.cancel, async (event) => {
    gate(event);
    return handlers.cancel();
  });
}

export function unregisterUpdateIpc(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(UPDATE_MAIN_IPC_CHANNELS)) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Test helper: ensure a status object has none of the internal fields
 * the coordinator / journal / adapters might carry.
 */
export function dtoOmitsInternalUpdateFields(status: UpdateStatus): boolean {
  const rec = status as unknown as Record<string, unknown>;
  const forbidden = [
    "lease",
    "grant",
    "grantToken",
    "downloadUrl",
    "url",
    "path",
    "stagedGrok",
    "stagedDesk",
    "privateKey",
    "privatePkcs8Base64",
    "deviceId",
    "activationId",
    "productKey",
    "manifestPayloadSha256",
    "digestSha256",
    "sha256",
    "journal",
  ];
  return forbidden.every((k) => !(k in rec));
}
