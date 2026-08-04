import { describe, it, expect, vi } from "vitest";
import {
  getDesktopTaskGrant,
  resumeDesktopTask,
  setDesktopTaskGrant,
  type DesktopTaskOpsDeps,
} from "./desktop-task-ops.js";

function deps(over: Partial<DesktopTaskOpsDeps> = {}): DesktopTaskOpsDeps {
  const grant = { granted: true, displayId: "main" };
  return {
    getGrant: () => grant,
    setGrant: vi.fn(),
    threadRootId: (id) => `root-of-${id}`,
    getMachineSettings: () => ({ enabled: true }),
    desktopGetStatus: async () => ({ softPaused: true }),
    desktopConfigure: vi.fn(async () => ({})),
    ...over,
  };
}

describe("desktop-task-ops", () => {
  it("getDesktopTaskGrant includes softPaused from host", async () => {
    const r = await getDesktopTaskGrant("t1", deps());
    expect(r).toEqual({
      granted: true,
      displayId: "main",
      softPaused: true,
    });
  });

  it("getDesktopTaskGrant softPaused false when host fails", async () => {
    const r = await getDesktopTaskGrant(
      "t1",
      deps({
        desktopGetStatus: async () => {
          throw new Error("no host");
        },
      }),
    );
    expect(r.softPaused).toBe(false);
  });

  it("setDesktopTaskGrant configures host with thread root", async () => {
    const configure = vi.fn(async () => ({}));
    const setGrant = vi.fn();
    const d = deps({
      desktopConfigure: configure,
      setGrant,
      getGrant: () => ({ granted: false, displayId: null }),
    });
    const r = await setDesktopTaskGrant(
      { taskId: "t1", granted: false, displayId: null },
      d,
    );
    expect(setGrant).toHaveBeenCalledWith("t1", false, null);
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "root-of-t1",
        granted: false,
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("resumeDesktopTask clears soft pause", async () => {
    const configure = vi.fn(async () => ({}));
    const r = await resumeDesktopTask(
      "t1",
      deps({ desktopConfigure: configure }),
    );
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        clearSoftPause: true,
        taskId: "root-of-t1",
      }),
    );
    expect(r.softPaused).toBe(false);
  });
});
