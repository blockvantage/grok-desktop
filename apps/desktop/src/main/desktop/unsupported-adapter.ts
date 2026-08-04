import type { DesktopDisplayInfo, DesktopPermissionStatus } from "@grokdesk/shared";
import type { CaptureResult, DesktopAdapter } from "./types";

export class UnsupportedDesktopAdapter implements DesktopAdapter {
  platform = "other" as const;

  async getPermissionStatus(): Promise<DesktopPermissionStatus> {
    return {
      captureGranted: false,
      inputGranted: false,
      captureDetail: "unsupported platform",
      inputDetail: "unsupported platform",
      platform: "other",
    };
  }

  async openCaptureSettings(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async openInputSettings(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async listDisplays(): Promise<DesktopDisplayInfo[]> {
    return [];
  }

  async captureDisplay(
    _displayId: string,
    _opts?: import("./types").CaptureDisplayOpts,
  ): Promise<CaptureResult> {
    throw new Error("desktop_not_supported");
  }

  async mouseMove(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async mouseClick(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async mouseDrag(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async typeText(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async key(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async scroll(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async openApp(): Promise<void> {
    throw new Error("desktop_not_supported");
  }

  async getFrontmost(): Promise<{ app: string | null; title: string | null }> {
    return { app: null, title: null };
  }

  startYieldMonitor(): () => void {
    return () => {};
  }
}
