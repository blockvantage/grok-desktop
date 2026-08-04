import { describe, expect, it, vi } from "vitest";
import {
  createE2eControlsState,
  E2E_IPC_CHANNELS,
  isE2eTestControlsEnabled,
  registerE2eTestControls,
  unregisterE2eTestControls,
} from "./e2e-test-controls";

describe("e2e-test-controls (Task 18)", () => {
  it("is disabled without GROKDESK_E2E=1 (production default)", () => {
    expect(isE2eTestControlsEnabled({})).toBe(false);
    expect(isE2eTestControlsEnabled({ GROKDESK_E2E: "0" })).toBe(false);
    expect(isE2eTestControlsEnabled({ GROKDESK_E2E: "1" })).toBe(true);
  });

  it("does not register handlers when e2e gate is off", () => {
    const handle = vi.fn();
    const registered = registerE2eTestControls({
      ipcMain: { handle },
      assertSender: () => {},
      env: {},
    });
    expect(registered).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("registers privileged channels only when gated", async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle: (
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => unknown,
      ) => {
        handlers.set(channel, listener);
      },
      removeHandler: (channel: string) => {
        handlers.delete(channel);
      },
    };
    const assertSender = vi.fn();
    const crash = vi.fn(async () => {});
    const state = createE2eControlsState();
    const registered = registerE2eTestControls({
      ipcMain,
      assertSender,
      env: { GROKDESK_E2E: "1" },
      gateway: { crashForTest: crash },
      state,
    });
    expect(registered).toBe(true);
    expect(handlers.has(E2E_IPC_CHANNELS.ping)).toBe(true);
    expect(handlers.has(E2E_IPC_CHANNELS.crashGateway)).toBe(true);
    expect(handlers.has(E2E_IPC_CHANNELS.injectFault)).toBe(true);

    const ping = handlers.get(E2E_IPC_CHANNELS.ping)!;
    await ping({});
    expect(assertSender).toHaveBeenCalled();

    const crashH = handlers.get(E2E_IPC_CHANNELS.crashGateway)!;
    await crashH({});
    expect(crash).toHaveBeenCalled();

    const inject = handlers.get(E2E_IPC_CHANNELS.injectFault)!;
    await inject({}, "persistence_failed");
    expect(state.fault).toBe("persistence_failed");

    unregisterE2eTestControls(ipcMain);
    expect(handlers.size).toBe(0);
  });
});
