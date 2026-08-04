/**
 * Shared helper for privileged ipcMain.handle registration.
 * Gates every invoke with assertSender (validatePrivilegedIpcSender) before
 * running the handler — same pattern as entitlements/ipc and updates/update-ipc.
 */

export type IpcMainHandleLike = {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ) => void;
};

/**
 * Register an ipcMain.handle that rejects untrusted senders first.
 */
export function registerPrivilegedHandle(
  ipcMain: IpcMainHandleLike,
  channel: string,
  assertSender: (event: unknown) => void,
  handler: (event: unknown, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSender(event);
    return handler(event, ...args);
  });
}
