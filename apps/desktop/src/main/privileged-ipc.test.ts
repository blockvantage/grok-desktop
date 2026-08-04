/**
 * F1: registerDesktopIpc-style handlers reject untrusted senders via the
 * shared privileged handle gate (same throw style as assertPrivilegedIpcSender).
 */
import { describe, expect, it, vi } from "vitest";
import { registerPrivilegedHandle } from "./privileged-ipc";
import { validatePrivilegedIpcSender } from "./ipc-sender";

function assertSenderLikeProduction(event: unknown): void {
  const e = event as { sender: { id?: number; getURL?: () => string } };
  const mainWc = { id: 1, getURL: () => "file:///app/index.html" };
  const check = validatePrivilegedIpcSender({
    sender: e.sender,
    mainWindow: { id: 10, webContents: mainWc },
    trustedDevOrigin: null,
  });
  if (!check.ok) {
    throw new Error(`IPC sender rejected: ${check.reason}`);
  }
}

describe("registerPrivilegedHandle (desktop IPC gate)", () => {
  it("rejects an untrusted sender on a representative channel (reveal)", async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, listener);
      },
    };

    const revealHandler = vi.fn(async () => ({ ok: true }));
    registerPrivilegedHandle(
      ipcMain,
      "grokdesk:reveal",
      assertSenderLikeProduction,
      revealHandler,
    );

    const listener = handlers.get("grokdesk:reveal");
    expect(listener).toBeTypeOf("function");

    const evilEvent = {
      sender: { id: 99, getURL: () => "https://evil.example/" },
    };
    await expect(
      listener!(evilEvent, "/etc/passwd"),
    ).rejects.toThrow(/IPC sender rejected/);
    expect(revealHandler).not.toHaveBeenCalled();
  });

  it("gates restartGateway channel the same way as other privileged channels", async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, listener);
      },
    };
    const restart = vi.fn(async () => ({ ok: true, status: "starting" }));
    registerPrivilegedHandle(
      ipcMain,
      "grokdesk:restartGateway",
      assertSenderLikeProduction,
      restart,
    );
    const listener = handlers.get("grokdesk:restartGateway");
    await expect(
      listener!({
        sender: { id: 99, getURL: () => "https://evil.example/" },
      }),
    ).rejects.toThrow(/IPC sender rejected/);
    expect(restart).not.toHaveBeenCalled();
  });

  it("allows the trusted main-window sender and runs the handler", async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, listener);
      },
    };

    const revealHandler = vi.fn(async (_e, filePath: unknown) => ({
      ok: true,
      path: String(filePath),
    }));
    registerPrivilegedHandle(
      ipcMain,
      "grokdesk:reveal",
      assertSenderLikeProduction,
      revealHandler,
    );

    const mainWc = { id: 1, getURL: () => "file:///app/index.html" };
    // Production validator accepts sender when id matches main webContents.
    const trustedEvent = { sender: mainWc };
    const result = await handlers.get("grokdesk:reveal")!(
      trustedEvent,
      "/allowed/workspaces/a.md",
    );
    expect(result).toEqual({
      ok: true,
      path: "/allowed/workspaces/a.md",
    });
    expect(revealHandler).toHaveBeenCalledOnce();
  });
});
