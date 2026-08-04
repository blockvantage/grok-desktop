/**
 * Renderer-safe update IPC channel names and action DTOs.
 *
 * Channels live here (not packages/shared/src/ipc.ts) to avoid the gateway
 * RPC hotspot. Main process owns all update policy, grants, and paths.
 * Renderer may only request status / check / install-restart / cancel and
 * subscribe to safe UpdateStatus pushes.
 */

import type { UpdateStatus } from "../update-status.js";

/**
 * Main-process-only IPC channels (Electron ipcMain / preload).
 * Intentionally NOT gateway RPC methods.
 */
export const UPDATE_MAIN_IPC_CHANNELS = {
  status: "grokdesk:update:status",
  check: "grokdesk:update:check",
  /** Customer "Update and restart" — main decides install timing. */
  installRestart: "grokdesk:update:install-restart",
  /** Explicit cancel of a staged / waiting-for-idle update (never silent). */
  cancel: "grokdesk:update:cancel",
  /** Main → renderer status push (UpdateStatus only; no secrets). */
  statusChanged: "grokdesk:update:status-changed",
} as const;

export type UpdateMainIpcChannel =
  (typeof UPDATE_MAIN_IPC_CHANNELS)[keyof typeof UPDATE_MAIN_IPC_CHANNELS];

/** Result of an update action IPC call — always a safe status DTO. */
export type UpdateActionResult = {
  ok: boolean;
  status: UpdateStatus;
  /** Stable code when ok is false (never free-form server text with secrets). */
  code?: string;
  message?: string;
};
