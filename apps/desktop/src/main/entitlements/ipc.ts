/**
 * Narrow main-process entitlement IPC.
 *
 * Renderer may call status / activate / deactivate / refresh only.
 * Responses are EntitlementStatusDto — never product keys, device private
 * keys, lease JWTs, nonces, proofs, or internal paths.
 *
 * Registration is optional: tests exercise pure handlers; index.ts wires
 * ipcMain later via registerEntitlementIpc.
 */

import type {
  EntitlementActivateParams,
  EntitlementDeviceSummaryDto,
  EntitlementStatusDto,
} from "@grokdesk/shared";
import { ENTITLEMENT_MAIN_IPC_CHANNELS } from "@grokdesk/shared";
import type { EntitlementManager, EntitlementStatus } from "./entitlement-manager.js";
import type { OsCredentialVault } from "./os-credential-vault.js";
import type { EntitlementStateStore } from "./state-store.js";
import {
  DEVICE_IDENTITY_ACCOUNT,
  PRODUCT_KEY_ACCOUNT,
  type DeviceIdentityRecord,
} from "./types.js";
export { ENTITLEMENT_MAIN_IPC_CHANNELS };

/** Seat limit is fixed for personal entitlements (GD3 claims). */
export const ENTITLEMENT_SEAT_LIMIT = 3 as const;

export type EntitlementIpcDeviceList = {
  activeDevices: number | null;
  devices: EntitlementDeviceSummaryDto[];
};

export type EntitlementIpcDeps = {
  manager: EntitlementManager;
  /** Required for local current-device deactivation (clear product key). */
  vault: OsCredentialVault;
  /** Required for local lease clear on deactivation. */
  stateStore: EntitlementStateStore;
  /**
   * Optional seat-limit device summaries from the last activation error body.
   * Main may stash these; never includes device IDs or keys.
   */
  getDeviceList?: () => EntitlementIpcDeviceList | null | undefined;
  /** Main-owned clipboard read; the key is activated without returning it. */
  readClipboardText?: () => string | Promise<string>;
  /** Main-owned file picker/read. Null means the user cancelled. */
  readImportedKeyText?: () => string | null | Promise<string | null>;
  now?: () => Date;
};

export type EntitlementIpcHandlers = {
  status: () => Promise<EntitlementStatusDto>;
  activate: (params: EntitlementActivateParams) => Promise<EntitlementStatusDto>;
  activateFromClipboard: () => Promise<EntitlementStatusDto>;
  activateFromFile: () => Promise<EntitlementStatusDto>;
  deactivate: () => Promise<EntitlementStatusDto>;
  refresh: () => Promise<EntitlementStatusDto>;
};

/** Minimal ipcMain surface for registration (avoids hard Electron import in tests). */
export type IpcMainLike = {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ) => void;
  removeHandler: (channel: string) => void;
};

/**
 * Strip manager status to the renderer-safe DTO.
 * Never copies lease, claims, deviceId, activationId, or vault material.
 */
export function toEntitlementStatusDto(
  status: EntitlementStatus,
  deviceList?: EntitlementIpcDeviceList | null,
): EntitlementStatusDto {
  const devices = deviceList?.devices ?? [];
  const activeDevices =
    deviceList?.activeDevices ??
    (devices.length > 0 ? devices.length : null);

  return {
    state: status.state,
    expiresAt: status.expiresAt,
    refreshAfter: status.refreshAfter,
    deviceName: status.deviceName,
    activeDevices,
    seatLimit: ENTITLEMENT_SEAT_LIMIT,
    devices: devices.map((d) => ({
      name: String(d.name ?? ""),
      platform: String(d.platform ?? ""),
      architecture: String(d.architecture ?? ""),
      lastSeenAt: String(d.lastSeenAt ?? ""),
    })),
    recoveryAction: status.recoveryAction,
    errorCode: status.lastError?.code ?? null,
    errorMessage: status.lastError?.message ?? null,
  };
}

/**
 * Canary: fail closed if a DTO / payload would leak commerce secrets.
 * Used by handlers (defensive) and unit tests.
 */
export function assertNoEntitlementSecrets(
  value: unknown,
  label = "entitlement dto",
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
  if (/"lease"\s*:/.test(text) && /eyJ[A-Za-z0-9_-]+\./.test(text)) {
    throw new Error(`${label}: lease JWT must not leave main`);
  }
  if (/"deviceId"\s*:/.test(text)) {
    throw new Error(`${label}: deviceId must not leave main`);
  }
  if (/"activationId"\s*:/.test(text)) {
    throw new Error(`${label}: activationId must not leave main`);
  }
  if (/"privatePkcs8Base64"\s*:/.test(text)) {
    throw new Error(`${label}: privatePkcs8Base64 must not leave main`);
  }
  if (/\/entitlements\/state\.json/.test(text)) {
    throw new Error(`${label}: internal state path must not leave main`);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function sanitizeActivateParams(
  params: unknown,
): EntitlementActivateParams {
  if (!params || typeof params !== "object") {
    // Empty key → manager/activation-flow maps to invalid_key_format status.
    return { productKey: "" };
  }
  const productKey = (params as { productKey?: unknown }).productKey;
  if (typeof productKey !== "string") {
    return { productKey: "" };
  }
  // Bound free-form paste size (matches extractGd3 max).
  if (productKey.length > 8 * 1024) {
    return { productKey: productKey.slice(0, 8 * 1024) };
  }
  return { productKey };
}

/**
 * Create pure entitlement IPC handlers bound to a manager + vault + store.
 */
export function createEntitlementIpcHandlers(
  deps: EntitlementIpcDeps,
): EntitlementIpcHandlers {
  const nowFn = deps.now ?? (() => new Date());

  async function statusDto(): Promise<EntitlementStatusDto> {
    const status = await deps.manager.getStatus();
    const dto = toEntitlementStatusDto(status, deps.getDeviceList?.());
    assertNoEntitlementSecrets(dto, "status");
    return dto;
  }

  return {
    status: statusDto,

    async activate(params: EntitlementActivateParams): Promise<EntitlementStatusDto> {
      const { productKey } = sanitizeActivateParams(params);
      // Activate stores key only on success / seat_limit; never returns key.
      await deps.manager.activate(productKey);
      return statusDto();
    },

    async activateFromClipboard(): Promise<EntitlementStatusDto> {
      const raw = await deps.readClipboardText?.();
      await deps.manager.activate(typeof raw === "string" ? raw : "");
      return statusDto();
    },

    async activateFromFile(): Promise<EntitlementStatusDto> {
      const raw = await deps.readImportedKeyText?.();
      if (raw === null) return statusDto();
      await deps.manager.activate(typeof raw === "string" ? raw : "");
      return statusDto();
    },

    async deactivate(): Promise<EntitlementStatusDto> {
      // Local current-device deactivation: drop product key + lease.
      // Remote seat release (challenge/signature) is layered later; local clear
      // is always required so the renderer never retains Grok capability.
      try {
        await deps.vault.delete(PRODUCT_KEY_ACCOUNT);
      } catch {
        // Best-effort: still clear lease if vault delete fails.
      }

      const existing = await deps.stateStore.read();
      if (existing) {
        await deps.stateStore.write({
          schema: 1,
          deviceId: existing.deviceId,
          devicePublicKeyThumbprint: existing.devicePublicKeyThumbprint,
          lease: null,
          authoritativeState: "device_deactivated",
          updatedAt: nowFn().toISOString(),
          requestId: existing.requestId,
        });
      }

      deps.manager.stop();
      return statusDto();
    },

    async refresh(): Promise<EntitlementStatusDto> {
      await deps.manager.refresh();
      return statusDto();
    },
  };
}

/**
 * Register handlers on Electron ipcMain (or a test double).
 * `assertSender` is required and fail-closed: missing gate rejects every
 * invoke so a mis-wired composition cannot expose activate/deactivate without
 * privileged-sender validation.
 */
export function registerEntitlementIpc(
  ipcMain: IpcMainLike,
  handlers: EntitlementIpcHandlers,
  assertSender?: (event: unknown) => void,
): void {
  const gate = (event: unknown) => {
    if (typeof assertSender !== "function") {
      throw new Error(
        "IPC sender rejected: entitlement assertSender not configured (fail-closed)",
      );
    }
    assertSender(event);
  };
  ipcMain.handle(ENTITLEMENT_MAIN_IPC_CHANNELS.status, async (event) => {
    gate(event);
    return handlers.status();
  });
  ipcMain.handle(
    ENTITLEMENT_MAIN_IPC_CHANNELS.activate,
    async (event, params: unknown) => {
      gate(event);
      return handlers.activate(sanitizeActivateParams(params));
    },
  );
  ipcMain.handle(
    ENTITLEMENT_MAIN_IPC_CHANNELS.activateFromClipboard,
    async (event) => {
      gate(event);
      return handlers.activateFromClipboard();
    },
  );
  ipcMain.handle(
    ENTITLEMENT_MAIN_IPC_CHANNELS.activateFromFile,
    async (event) => {
      gate(event);
      return handlers.activateFromFile();
    },
  );
  ipcMain.handle(ENTITLEMENT_MAIN_IPC_CHANNELS.deactivate, async (event) => {
    gate(event);
    return handlers.deactivate();
  });
  ipcMain.handle(ENTITLEMENT_MAIN_IPC_CHANNELS.refresh, async (event) => {
    gate(event);
    return handlers.refresh();
  });
}

export function unregisterEntitlementIpc(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(ENTITLEMENT_MAIN_IPC_CHANNELS)) {
    // statusChanged is a push channel, not a handle — removeHandler is harmless.
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Test helper: ensure a status-like object has none of the secret fields
 * the manager/internal records might carry.
 */
export function dtoOmitsInternalFields(dto: EntitlementStatusDto): boolean {
  const rec = dto as unknown as Record<string, unknown>;
  const forbidden = [
    "lease",
    "claims",
    "deviceId",
    "activationId",
    "productKey",
    "privateKey",
    "privatePkcs8Base64",
    "publicJwk",
    "statePath",
    "authoritativeState",
    "lastError",
  ];
  return forbidden.every((k) => !(k in rec));
}

/** Re-export for tests that build identity records. */
export type { DeviceIdentityRecord };
export { DEVICE_IDENTITY_ACCOUNT, PRODUCT_KEY_ACCOUNT };
