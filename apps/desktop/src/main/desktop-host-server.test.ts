import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DesktopPolicyStore } from "./desktop-policy-store";
import { DesktopUseService } from "./desktop-use-service";
import { startDesktopHostServer, type DesktopHostServer } from "./desktop-host-server";
import type { DesktopAdapter, CaptureResult } from "./desktop/types";
import type { DesktopDisplayInfo, DesktopPermissionStatus } from "@grokdesk/shared";
import { createSolidPng } from "./desktop/resize-png";

function mockAdapter(): DesktopAdapter {
  const display: DesktopDisplayInfo = {
    id: "d0",
    label: "Mock",
    width: 100,
    height: 100,
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    isPrimary: true,
  };
  return {
    platform: "darwin",
    async getPermissionStatus(): Promise<DesktopPermissionStatus> {
      return {
        captureGranted: true,
        inputGranted: true,
        captureDetail: "ok",
        inputDetail: "ok",
        platform: "darwin",
      };
    },
    async openCaptureSettings() {},
    async openInputSettings() {},
    async listDisplays() {
      return [display];
    },
    async captureDisplay(): Promise<CaptureResult> {
      return {
        bytes: createSolidPng(100, 100),
        mime: "image/png",
        deviceWidth: 100,
        deviceHeight: 100,
        scaleFactor: 1,
        bounds: display.bounds,
      };
    },
    async mouseMove() {},
    async mouseClick() {},
    async mouseDrag() {},
    async typeText() {},
    async key() {},
    async scroll() {},
    async openApp() {},
    async getFrontmost() {
      return { app: "Test", title: "T" };
    },
    startYieldMonitor() {
      return () => {};
    },
  };
}

describe("desktop-host-server", () => {
  let host: DesktopHostServer;
  let policy: DesktopPolicyStore;

  beforeEach(async () => {
    policy = new DesktopPolicyStore();
    policy.setMachine({ enabled: true });
    policy.setGrant("task-1", true);
    const service = new DesktopUseService(policy, mockAdapter());
    host = await startDesktopHostServer(service, policy);
  });

  afterEach(async () => {
    await host.close();
  });

  it("rejects bad token", async () => {
    const res = await fetch(`${host.url}/exec`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-grokdesk-desktop-token": "wrong",
      },
      body: JSON.stringify({
        taskId: "task-1",
        tool: "desktop_screenshot",
        args: {},
      }),
    });
    expect(res.status).toBe(401);
  });

  it("executes screenshot with valid token", async () => {
    const res = await fetch(`${host.url}/exec`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-grokdesk-desktop-token": host.token,
      },
      body: JSON.stringify({
        taskId: "task-1",
        tool: "desktop_screenshot",
        args: {},
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; width?: number };
    expect(body.ok).toBe(true);
    expect(body.width).toBeGreaterThan(0);
  });

  it("health ok", async () => {
    const res = await fetch(`${host.url}/health`, {
      headers: { "x-grokdesk-desktop-token": host.token },
    });
    expect(res.status).toBe(200);
  });
});
