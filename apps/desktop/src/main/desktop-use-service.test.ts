import { describe, it, expect, beforeEach } from "vitest";
import { DesktopPolicyStore } from "./desktop-policy-store";
import { DesktopUseService } from "./desktop-use-service";
import type { CaptureResult, DesktopAdapter } from "./desktop/types";
import type { DesktopDisplayInfo, DesktopPermissionStatus } from "@grokdesk/shared";
import { createSolidPng, readPngSize } from "./desktop/resize-png";

type Recorded =
  | { op: "move"; x: number; y: number }
  | { op: "click"; x: number; y: number; button: string; count: number }
  | { op: "drag"; x1: number; y1: number; x2: number; y2: number }
  | { op: "type"; text: string }
  | { op: "key"; key: string; modifiers: string[] }
  | { op: "scroll"; x: number; y: number; dx: number; dy: number }
  | { op: "open"; name?: string; path?: string };

function createMockAdapter(opts?: {
  yieldOnClick?: boolean;
  app?: string;
  /** Physical size of display */
  deviceW?: number;
  deviceH?: number;
  scaleFactor?: number;
}): { adapter: DesktopAdapter; actions: Recorded[] } {
  const actions: Recorded[] = [];
  let yieldCb: (() => void) | null = null;
  const deviceW = opts?.deviceW ?? 200;
  const deviceH = opts?.deviceH ?? 100;
  const scaleFactor = opts?.scaleFactor ?? 2;
  const display: DesktopDisplayInfo = {
    id: "d0",
    label: "Mock",
    width: deviceW,
    height: deviceH,
    scaleFactor,
    // DIP bounds (not physical)
    bounds: {
      x: 0,
      y: 0,
      width: Math.round(deviceW / scaleFactor),
      height: Math.round(deviceH / scaleFactor),
    },
    isPrimary: true,
  };

  const adapter: DesktopAdapter = {
    platform: "darwin",
    async getPermissionStatus(): Promise<DesktopPermissionStatus> {
      return {
        captureGranted: true,
        inputGranted: true,
        captureDetail: "mock",
        inputDetail: "mock",
        platform: "darwin",
      };
    },
    async openCaptureSettings() {},
    async openInputSettings() {},
    async listDisplays() {
      return [display];
    },
    async captureDisplay(
      _id: string,
      capOpts?: { targetWidth?: number; targetHeight?: number },
    ): Promise<CaptureResult> {
      // Return full physical PNG; service must resize to target
      const png = createSolidPng(deviceW, deviceH, [1, 2, 3]);
      return {
        bytes: png,
        mime: "image/png",
        deviceWidth: deviceW,
        deviceHeight: deviceH,
        scaleFactor,
        bounds: display.bounds,
      };
    },
    async mouseMove(x, y) {
      actions.push({ op: "move", x, y });
    },
    async mouseClick({ screenX, screenY, button, count }) {
      if (opts?.yieldOnClick && yieldCb) yieldCb();
      actions.push({
        op: "click",
        x: screenX,
        y: screenY,
        button,
        count,
      });
    },
    async mouseDrag({ x1, y1, x2, y2 }) {
      actions.push({ op: "drag", x1, y1, x2, y2 });
    },
    async typeText(text) {
      actions.push({ op: "type", text });
    },
    async key({ key, modifiers }) {
      actions.push({ op: "key", key, modifiers });
    },
    async scroll({ screenX, screenY, dx, dy }) {
      actions.push({ op: "scroll", x: screenX, y: screenY, dx, dy });
    },
    async openApp({ name, path }) {
      actions.push({ op: "open", name, path });
    },
    async getFrontmost() {
      return { app: opts?.app ?? "MockApp", title: "Win" };
    },
    startYieldMonitor(onYield) {
      yieldCb = onYield;
      return () => {
        yieldCb = null;
      };
    },
  };
  return { adapter, actions };
}

describe("DesktopUseService", () => {
  let policy: DesktopPolicyStore;
  let actions: Recorded[];
  let service: DesktopUseService;

  beforeEach(() => {
    policy = new DesktopPolicyStore();
    policy.setMachine({
      enabled: true,
      maxScreenshotLongEdge: 100, // half of 200 long edge → image 100×50
    });
    policy.setGrant("t1", true);
    const mock = createMockAdapter();
    actions = mock.actions;
    service = new DesktopUseService(policy, mock.adapter);
  });

  it("denies exec when grant off", async () => {
    policy.setGrant("t1", false);
    const r = await service.exec("t1", "desktop_screenshot", {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe("desktop_disabled_task");
  });

  it("screenshot returns image whose IHDR matches reported width×height", async () => {
    const r = await service.exec("t1", "desktop_screenshot", {});
    expect(r.ok).toBe(true);
    expect(r.width).toBe(100);
    expect(r.height).toBe(50);
    expect(r.screenshot).toMatch(/^data:image\/png;base64,/);
    const b64 = r.screenshot!.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    expect(readPngSize(buf)).toEqual({ width: 100, height: 50 });
    expect(r.imageToDeviceScale).toBeCloseTo(2);
  });

  it("maps click through Retina: image → device → DIP for CGEvent", async () => {
    await service.exec("t1", "desktop_screenshot", {});
    // image 100×50; click (50, 25) → device (100, 50) → DIP (50, 25) at scale 2
    const r = await service.exec("t1", "desktop_click", { x: 50, y: 25 });
    expect(r.ok).toBe(true);
    const click = actions.find((a) => a.op === "click");
    expect(click).toMatchObject({ op: "click", x: 50, y: 25 });
  });

  it("records type, key, scroll, drag, list_displays, open_app", async () => {
    expect((await service.exec("t1", "desktop_list_displays", {})).ok).toBe(
      true,
    );
    await service.exec("t1", "desktop_screenshot", {});
    expect(
      (await service.exec("t1", "desktop_type", { text: "hi" })).ok,
    ).toBe(true);
    expect(
      (
        await service.exec("t1", "desktop_key", {
          key: "enter",
          modifiers: ["cmd"],
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await service.exec("t1", "desktop_scroll", {
          x: 10,
          y: 10,
          dy: -120,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await service.exec("t1", "desktop_drag", {
          x1: 0,
          y1: 0,
          x2: 10,
          y2: 10,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await service.exec("t1", "desktop_open_app", {
          name: "Calculator",
        })
      ).ok,
    ).toBe(true);
    expect(
      (await service.exec("t1", "desktop_mouse_move", { x: 1, y: 1 })).ok,
    ).toBe(true);
    expect(
      (
        await service.exec("t1", "desktop_double_click", { x: 5, y: 5 })
      ).ok,
    ).toBe(true);
    expect(
      (await service.exec("t1", "desktop_wait", { ms: 1 })).ok,
    ).toBe(true);

    expect(actions.some((a) => a.op === "type" && a.text === "hi")).toBe(true);
    expect(actions.some((a) => a.op === "key" && a.key === "enter")).toBe(
      true,
    );
    expect(actions.some((a) => a.op === "scroll")).toBe(true);
    expect(actions.some((a) => a.op === "drag")).toBe(true);
    expect(actions.some((a) => a.op === "open")).toBe(true);
  });

  it("soft-pauses on yield during click", async () => {
    const mock = createMockAdapter({ yieldOnClick: true });
    const svc = new DesktopUseService(policy, mock.adapter);
    await svc.exec("t1", "desktop_screenshot", {});
    const r = await svc.exec("t1", "desktop_click", { x: 1, y: 1 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("desktop_yielded");
    expect(policy.getTaskState("t1")?.softPaused).toBe(true);
  });

  it("denies denylisted app", async () => {
    const mock = createMockAdapter({ app: "Bitwarden" });
    const svc = new DesktopUseService(policy, mock.adapter);
    const r = await svc.exec("t1", "desktop_type", { text: "x" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("desktop_denied_target");
  });
});
