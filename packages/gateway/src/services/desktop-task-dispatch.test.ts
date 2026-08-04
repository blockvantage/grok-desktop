import { describe, it, expect, vi } from "vitest";
import {
  dispatchDesktopTaskMethod,
  isDesktopTaskMethod,
} from "./desktop-task-dispatch.js";

describe("isDesktopTaskMethod", () => {
  it("matches desktop.task.*", () => {
    expect(isDesktopTaskMethod("desktop.task.resume")).toBe(true);
    expect(isDesktopTaskMethod("tasks.list")).toBe(false);
  });
});

describe("dispatchDesktopTaskMethod", () => {
  it("getGrant and resume use taskId", async () => {
    const getGrant = vi.fn(() => ({ granted: true }));
    const resume = vi.fn(async () => ({ ok: true }));
    const deps = {
      getGrant,
      setGrant: vi.fn(),
      resume,
    };
    await expect(
      dispatchDesktopTaskMethod(
        "desktop.task.getGrant",
        { taskId: "t1" },
        deps,
      ),
    ).resolves.toEqual({ granted: true });
    await expect(
      dispatchDesktopTaskMethod(
        "desktop.task.resume",
        { taskId: "t1" },
        deps,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("setGrant requires taskId", async () => {
    const deps = {
      getGrant: vi.fn(),
      setGrant: vi.fn(() => ({ ok: true })),
      resume: vi.fn(),
    };
    await expect(
      dispatchDesktopTaskMethod(
        "desktop.task.setGrant",
        { granted: true },
        deps,
      ),
    ).rejects.toThrow(/taskId/);
    await expect(
      dispatchDesktopTaskMethod(
        "desktop.task.setGrant",
        { taskId: "t1", granted: true, displayId: null },
        deps,
      ),
    ).resolves.toEqual({ ok: true });
  });
});
