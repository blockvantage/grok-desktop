import { describe, expect, it, vi } from "vitest";
import type { HostBridge } from "../host-bridge.js";
import type { SettingsService } from "./settings.js";
import { TelepresenceService } from "./telepresence.js";
type ExecCall = { tool: string; args: Record<string, unknown> };

function mockHost(
  tools: string[],
  execCalls?: ExecCall[],
): HostBridge {
  return {
    async browserExec() {
      return { ok: false, output: "n/a" };
    },
    async browserConfigure() {},
    async browserRememberOrigin() {},
    async browserResolveApproval() {
      return false;
    },
    async browserDestroy() {},
    async desktopExec(req) {
      tools.push(req.tool);
      execCalls?.push({ tool: req.tool, args: { ...req.args } });
      if (req.tool === "desktop_list_displays") {
        return {
          ok: true,
          output: "displays: 2",
          displays: [
            {
              id: "primary",
              label: "Built-in",
              width: 1920,
              height: 1080,
              scaleFactor: 2,
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              isPrimary: true,
            },
            {
              id: "ext-1",
              label: "External",
              width: 2560,
              height: 1440,
              scaleFactor: 1,
              bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
              isPrimary: false,
            },
          ],
        };
      }
      if (req.tool === "desktop_screenshot") {
        // 1x1 jpeg-ish data url
        return {
          ok: true,
          output: "ok",
          screenshot:
            "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
          width: 100,
          height: 80,
          displayId: "primary",
        };
      }
      if (req.tool === "desktop_click") {
        return {
          ok: true,
          output: `click ${req.args.x},${req.args.y}`,
        };
      }
      if (req.tool === "desktop_drag") {
        return {
          ok: true,
          output: `drag ${req.args.x1},${req.args.y1}->${req.args.x2},${req.args.y2}`,
        };
      }
      if (req.tool === "desktop_scroll") {
        return {
          ok: true,
          output: `scroll ${req.args.dx},${req.args.dy}`,
        };
      }
      if (req.tool === "desktop_type") {
        return { ok: true, output: "typed" };
      }
      return { ok: true, output: req.tool };
    },
    async desktopConfigure() {
      tools.push("configure");
    },
    async desktopGetStatus() {
      return null;
    },
    async desktopDestroy() {
      tools.push("destroy");
    },
    async desktopPermissions() {
      return {
        captureGranted: true,
        inputGranted: true,
        captureDetail: "mock",
        inputDetail: "mock",
        platform: "other",
      };
    },
  };
}

function mockSettings(): SettingsService {
  return {
    getAll: () => ({
      desktopControl: {
        enabled: false,
        defaultDisplayId: null,
        maxActionsPerMinute: 120,
        maxActionsPerTask: 10000,
        maxScreenshotLongEdge: 1280,
        screenshotFormat: "jpeg",
        screenshotJpegQuality: 70,
      },
    }),
  } as unknown as SettingsService;
}

describe("TelepresenceService", () => {
  it("start/stop uses host configure and destroys session", async () => {
    const calls: string[] = [];
    const svc = new TelepresenceService(mockHost(calls), mockSettings());
    const frames: unknown[] = [];
    svc.setFrameSink((_d, f) => frames.push(f));
    const st = await svc.start({ deviceId: "d1", quality: "smooth" });
    expect(st.active).toBe(true);
    expect(st.deviceId).toBe("d1");
    expect(st.quality).toBe("smooth");
    expect(calls).toContain("configure");
    await svc.captureOnce();
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const stopped = await svc.stop();
    expect(stopped.active).toBe(false);
    expect(calls).toContain("destroy");
  });

  it("maps normalized tap to desktop_click image coords", async () => {
    const calls: string[] = [];
    const exec: ExecCall[] = [];
    const host = mockHost(calls, exec);
    const svc = new TelepresenceService(host, mockSettings());
    await svc.start({ deviceId: "d1", quality: "auto" });
    await svc.captureOnce();
    const r = await svc.handleInput({
      kind: "tap",
      nx: 0.5,
      ny: 0.25,
    });
    expect(r.ok).toBe(true);
    expect(calls).toContain("desktop_click");
    const click = exec.find((c) => c.tool === "desktop_click");
    expect(click?.args.x).toBe(50); // 0.5 * (100-1) rounded
    expect(click?.args.y).toBe(20); // 0.25 * (80-1) rounded
    await svc.stop();
  });

  it("drag maps to desktop_drag with start/end image coords", async () => {
    const calls: string[] = [];
    const exec: ExecCall[] = [];
    const svc = new TelepresenceService(mockHost(calls, exec), mockSettings());
    await svc.start({ deviceId: "d1" });
    await svc.captureOnce(); // image 100x80
    // Letterboxed content: view 200x100 fits 100x100 image → content 100x100 at x=50
    // Use nx/ny for unambiguous mapping through shipped handleInput
    const r = await svc.handleInput({
      kind: "drag",
      nx: 0.1,
      ny: 0.2,
      nx2: 0.9,
      ny2: 0.8,
    });
    expect(r.ok).toBe(true);
    expect(calls).toContain("desktop_drag");
    const drag = exec.find((c) => c.tool === "desktop_drag");
    expect(drag).toBeTruthy();
    expect(drag!.args.x1).toBe(10); // 0.1 * 99
    expect(drag!.args.y1).toBe(16); // 0.2 * 79
    expect(drag!.args.x2).toBe(89); // 0.9 * 99
    expect(drag!.args.y2).toBe(63); // 0.8 * 79
    // Would fail if drag branch removed — no desktop_drag call
    expect(exec.some((c) => c.tool === "desktop_click")).toBe(false);
    await svc.stop();
  });

  it("scroll maps to desktop_scroll with dx/dy via HostBridge", async () => {
    const calls: string[] = [];
    const exec: ExecCall[] = [];
    const svc = new TelepresenceService(mockHost(calls, exec), mockSettings());
    await svc.start({ deviceId: "d1" });
    await svc.captureOnce();
    const r = await svc.handleInput({
      kind: "scroll",
      nx: 0.5,
      ny: 0.5,
      dx: 12,
      dy: -40,
    });
    expect(r.ok).toBe(true);
    expect(calls).toContain("desktop_scroll");
    const scroll = exec.find((c) => c.tool === "desktop_scroll");
    expect(scroll).toBeTruthy();
    expect(scroll!.args.dx).toBe(12);
    expect(scroll!.args.dy).toBe(-40);
    expect(scroll!.args.x).toBe(50);
    expect(scroll!.args.y).toBe(40);
    await svc.stop();
  });

  it("auto-captures before pointer input when no frame dimensions yet", async () => {
    const calls: string[] = [];
    const exec: ExecCall[] = [];
    const svc = new TelepresenceService(mockHost(calls, exec), mockSettings());
    await svc.start({ deviceId: "d1" });
    // Do not call captureOnce — handleInput should capture first
    const r = await svc.handleInput({ kind: "tap", nx: 0.5, ny: 0.5 });
    expect(r.ok).toBe(true);
    expect(calls.filter((t) => t === "desktop_screenshot").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(calls).toContain("desktop_click");
    await svc.stop();
  });

  it("setQuality changes constraints between smooth and crisp", async () => {
    const svc = new TelepresenceService(mockHost([]), mockSettings());
    await svc.start({ deviceId: "d1", quality: "smooth" });
    expect(svc.getState().quality).toBe("smooth");
    await svc.setQuality("crisp");
    expect(svc.getState().quality).toBe("crisp");
    await svc.stop();
  });

  it("stopIfDevice only stops matching device", async () => {
    const svc = new TelepresenceService(mockHost([]), mockSettings());
    await svc.start({ deviceId: "d1" });
    await svc.stopIfDevice("other");
    expect(svc.getState().active).toBe(true);
    await svc.stopIfDevice("d1");
    expect(svc.getState().active).toBe(false);
  });

  it("listDisplays returns host displays via desktop_list_displays", async () => {
    const calls: string[] = [];
    const svc = new TelepresenceService(mockHost(calls), mockSettings());
    const list = await svc.listDisplays();
    expect(calls).toContain("desktop_list_displays");
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe("primary");
    expect(list[0]!.isPrimary).toBe(true);
    expect(list[1]!.id).toBe("ext-1");
  });

  it("start with displayId and setDisplay switch capture target", async () => {
    const exec: ExecCall[] = [];
    const svc = new TelepresenceService(mockHost([], exec), mockSettings());
    await svc.start({ deviceId: "d1", displayId: "ext-1" });
    expect(svc.getState().displayId).toBe("ext-1");
    await svc.setDisplay("primary");
    expect(svc.getState().displayId).toBe("primary");
    // Clear earlier frames from start() so we assert the post-switch capture args
    exec.length = 0;
    await svc.captureOnce();
    const shot = exec.find((c) => c.tool === "desktop_screenshot");
    expect(shot?.args.displayId).toBe("primary");
    await svc.stop();
  });
});
