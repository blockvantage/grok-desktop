/**
 * Renderer-safe entitlement DTOs and main-process IPC channel names.
 *
 * Never include product keys (GD3), device private keys, lease JWT, challenge
 * nonces, proofs, tokens, raw server bodies, or internal filesystem paths.
 */

import type { DesktopLicenseState } from "./states.js";

/** Recovery actions the renderer may surface (mirrors main error-map). */
export type EntitlementRecoveryAction =
  | "none"
  | "retry"
  | "portal"
  | "purchase"
  | "credential_help";

/** Redacted device seat summary for seat-limit UX. */
export type EntitlementDeviceSummaryDto = {
  name: string;
  platform: string;
  architecture: string;
  lastSeenAt: string;
};

/**
 * Safe entitlement status exposed to the renderer.
 * `seatLimit` is fixed at 3 for personal entitlements.
 */
export type EntitlementStatusDto = {
  state: DesktopLicenseState;
  expiresAt: string | null;
  refreshAfter: string | null;
  deviceName: string;
  activeDevices: number | null;
  seatLimit: 3;
  devices: EntitlementDeviceSummaryDto[];
  recoveryAction: EntitlementRecoveryAction;
  /** Stable error code only (never free-form server text). */
  errorCode: string | null;
  /** Safe human message from the frozen contract table (or null). */
  errorMessage: string | null;
};

/**
 * Main-process-only IPC channels (Electron ipcMain / preload).
 * These are intentionally NOT gateway RPC methods (`license.*` remains legacy).
 */
export const ENTITLEMENT_MAIN_IPC_CHANNELS = {
  status: "grokdesk:entitlement:status",
  activate: "grokdesk:entitlement:activate",
  activateFromClipboard: "grokdesk:entitlement:activate-from-clipboard",
  activateFromFile: "grokdesk:entitlement:activate-from-file",
  deactivate: "grokdesk:entitlement:deactivate",
  refresh: "grokdesk:entitlement:refresh",
  /** Main → renderer status push (no secrets). */
  statusChanged: "grokdesk:entitlement:status-changed",
} as const;

export type EntitlementMainIpcChannel =
  (typeof ENTITLEMENT_MAIN_IPC_CHANNELS)[keyof typeof ENTITLEMENT_MAIN_IPC_CHANNELS];

/** Params for typed product-key activation (one-shot; renderer clears after send). */
export type EntitlementActivateParams = {
  productKey: string;
};
