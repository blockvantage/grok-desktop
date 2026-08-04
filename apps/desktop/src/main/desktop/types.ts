import type {
  DesktopDisplayInfo,
  DesktopPermissionStatus,
} from "@grokdesk/shared";

export type CaptureResult = {
  /** Raw image bytes (png or jpeg) — should match model image space after service resize */
  bytes: Buffer;
  mime: "image/png" | "image/jpeg";
  /** Physical display pixel size (backing store) for coordinate mapping */
  deviceWidth: number;
  deviceHeight: number;
  scaleFactor: number;
  /**
   * Display origin/size in **DIP/points** (Electron display.bounds).
   * Used for CGEvent / logical cursor injection — not physical pixels.
   */
  bounds: { x: number; y: number; width: number; height: number };
};

export type CaptureDisplayOpts = {
  /** Preferred bitmap size for the model (service ensures exact match). */
  targetWidth?: number;
  targetHeight?: number;
};

/**
 * OS-specific capture + synthetic input.
 * Implementations must not import gateway; pure host I/O.
 */
export interface DesktopAdapter {
  platform: "darwin" | "win32" | "other";
  getPermissionStatus(): Promise<DesktopPermissionStatus>;
  openCaptureSettings(): Promise<void>;
  openInputSettings(): Promise<void>;
  listDisplays(): Promise<DesktopDisplayInfo[]>;
  captureDisplay(
    displayId: string,
    opts?: CaptureDisplayOpts,
  ): Promise<CaptureResult>;
  /** screenX/Y are global **DIP/points** (not device pixels). */
  mouseMove(screenX: number, screenY: number): Promise<void>;
  mouseClick(opts: {
    screenX: number;
    screenY: number;
    button: "left" | "right" | "middle";
    count: number;
  }): Promise<void>;
  mouseDrag(opts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    durationMs: number;
  }): Promise<void>;
  typeText(text: string): Promise<void>;
  key(opts: { key: string; modifiers: string[] }): Promise<void>;
  scroll(opts: {
    screenX: number;
    screenY: number;
    dx: number;
    dy: number;
  }): Promise<void>;
  openApp(opts: { name?: string; path?: string }): Promise<void>;
  getFrontmost(): Promise<{ app: string | null; title: string | null }>;
  /**
   * During exclusive control, detect real user mouse movement.
   * Returns stop function.
   */
  startYieldMonitor(onYield: () => void): () => void;
  /** Optional: current pointer position for yield comparison */
  getCursorPosition?(): Promise<{ x: number; y: number } | null>;
}

export type CaptureMeta = {
  displayId: string;
  imageW: number;
  imageH: number;
  deviceW: number;
  deviceH: number;
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number };
  imageToDeviceScale: number;
};
