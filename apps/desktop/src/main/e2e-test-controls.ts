/**
 * Test-only IPC controls for deterministic Electron E2E (Task 18).
 * Registered only when GROKDESK_E2E=1. Production builds must never expose these.
 */
import type { IpcMainHandleLike } from "./privileged-ipc";
import { registerPrivilegedHandle } from "./privileged-ipc";

export const E2E_IPC_CHANNELS = {
  crashGateway: "grokdesk:e2e:crashGateway",
  injectFault: "grokdesk:e2e:injectFault",
  clearFault: "grokdesk:e2e:clearFault",
  ping: "grokdesk:e2e:ping",
} as const;

export type E2eFaultKind =
  | "persistence_failed"
  | "provider_timeout"
  | "provider_error"
  | "none";

export type E2eTestControlsState = {
  fault: E2eFaultKind;
};

/** Pure gate: handlers may register only with explicit GROKDESK_E2E=1. */
export function isE2eTestControlsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.GROKDESK_E2E === "1";
}

export function createE2eControlsState(): E2eTestControlsState {
  return { fault: "none" };
}

/**
 * Register privileged E2E controls. No-ops when GROKDESK_E2E is not "1".
 * Returns true when handlers were registered.
 */
export function registerE2eTestControls(opts: {
  ipcMain: IpcMainHandleLike & {
    removeHandler?: (channel: string) => void;
  };
  assertSender: (event: unknown) => void;
  env?: NodeJS.ProcessEnv;
  gateway?: {
    /** Force-kill gateway child for crash/restart journeys. */
    crashForTest?: () => void | Promise<void>;
    restart?: () => void | Promise<void>;
  } | null;
  state?: E2eTestControlsState;
}): boolean {
  if (!isE2eTestControlsEnabled(opts.env ?? process.env)) {
    return false;
  }
  const state = opts.state ?? createE2eControlsState();

  registerPrivilegedHandle(
    opts.ipcMain,
    E2E_IPC_CHANNELS.ping,
    opts.assertSender,
    async () => ({ ok: true, e2e: true as const }),
  );

  registerPrivilegedHandle(
    opts.ipcMain,
    E2E_IPC_CHANNELS.crashGateway,
    opts.assertSender,
    async () => {
      if (opts.gateway?.crashForTest) {
        await opts.gateway.crashForTest();
        return { ok: true as const };
      }
      if (opts.gateway?.restart) {
        await opts.gateway.restart();
        return { ok: true as const, via: "restart" as const };
      }
      return { ok: false as const, error: "gateway_unavailable" };
    },
  );

  registerPrivilegedHandle(
    opts.ipcMain,
    E2E_IPC_CHANNELS.injectFault,
    opts.assertSender,
    async (_event, kind: unknown) => {
      const k = typeof kind === "string" ? kind : "none";
      if (
        k === "persistence_failed" ||
        k === "provider_timeout" ||
        k === "provider_error" ||
        k === "none"
      ) {
        state.fault = k;
        return { ok: true as const, fault: state.fault };
      }
      return { ok: false as const, error: "unknown_fault" };
    },
  );

  registerPrivilegedHandle(
    opts.ipcMain,
    E2E_IPC_CHANNELS.clearFault,
    opts.assertSender,
    async () => {
      state.fault = "none";
      return { ok: true as const, fault: state.fault };
    },
  );

  return true;
}

export function unregisterE2eTestControls(
  ipcMain: { removeHandler: (channel: string) => void },
): void {
  for (const ch of Object.values(E2E_IPC_CHANNELS)) {
    try {
      ipcMain.removeHandler(ch);
    } catch {
      /* */
    }
  }
}
