import { describe, it, expect, vi } from "vitest";
import { dispatchAuthMethod, isAuthMethod } from "./auth-dispatch.js";

describe("isAuthMethod", () => {
  it("matches auth.*", () => {
    expect(isAuthMethod("auth.status")).toBe(true);
    expect(isAuthMethod("auth.usage")).toBe(true);
    expect(isAuthMethod("tasks.list")).toBe(false);
  });
});

describe("dispatchAuthMethod", () => {
  it("status/signIn/signOut call deps", async () => {
    const deps = {
      authStatus: vi.fn(async () => ({ signedIn: true })),
      authSignIn: vi.fn(async () => ({ ok: true })),
      authSignOut: vi.fn(async () => ({ ok: true })),
      isMainProcessAuthMethod: () => true,
      mainProcessAuthErrorMessage: (m: string) => `main-only:${m}`,
    };
    await expect(dispatchAuthMethod("auth.status", deps)).resolves.toEqual({
      signedIn: true,
    });
    await expect(dispatchAuthMethod("auth.signIn", deps)).resolves.toEqual({
      ok: true,
    });
    await expect(dispatchAuthMethod("auth.signOut", deps)).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects main-process-only methods", async () => {
    const deps = {
      authStatus: vi.fn(),
      authSignIn: vi.fn(),
      authSignOut: vi.fn(),
      isMainProcessAuthMethod: () => true,
      mainProcessAuthErrorMessage: (m: string) => `main-only:${m}`,
    };
    await expect(dispatchAuthMethod("auth.usage", deps)).rejects.toThrow(
      /main-only:auth\.usage/,
    );
  });
});
