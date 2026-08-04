import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { DesktopDisplayInfo, DesktopPermissionStatus } from "@grokdesk/shared";
import type {
  CaptureDisplayOpts,
  CaptureResult,
  DesktopAdapter,
} from "./types";
import {
  cgEventTypesForButton,
  electronDisplayToMetrics,
} from "./mac-coord-math";

const execFileAsync = promisify(execFile);

/**
 * macOS desktop adapter: Screen Recording + Accessibility.
 * Capture via `screencapture` / Electron desktopCapturer when available.
 * Input via CoreGraphics through Python ctypes (no native node addon).
 */
export class MacDesktopAdapter implements DesktopAdapter {
  platform = "darwin" as const;
  private lastInjectAt = 0;

  async getPermissionStatus(): Promise<DesktopPermissionStatus> {
    let captureGranted = false;
    let captureDetail = "unknown";
    let inputGranted = false;
    let inputDetail = "unknown";

    try {
      // Electron systemPreferences when available
      const electron = await import("electron").catch(() => null);
      if (electron?.systemPreferences) {
        const sp = electron.systemPreferences;
        const media =
          typeof sp.getMediaAccessStatus === "function"
            ? sp.getMediaAccessStatus("screen")
            : "unknown";
        captureGranted = media === "granted";
        captureDetail = `screen=${media}`;
        if (typeof sp.isTrustedAccessibilityClient === "function") {
          inputGranted = sp.isTrustedAccessibilityClient(false);
          inputDetail = inputGranted
            ? "accessibility trusted"
            : "accessibility not trusted";
        }
      } else {
        // CLI fallback: try a tiny capture
        captureGranted = true;
        captureDetail = "no-electron; assume probe at capture time";
        inputGranted = true;
        inputDetail = "no-electron; assume probe at input time";
      }
    } catch (e) {
      captureDetail = e instanceof Error ? e.message : String(e);
    }

    return {
      captureGranted,
      inputGranted,
      captureDetail,
      inputDetail,
      platform: "darwin",
    };
  }

  async openCaptureSettings(): Promise<void> {
    await execFileAsync("open", [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    ]).catch(async () => {
      await execFileAsync("open", [
        "x-apple.systempreferences:com.apple.Settings.PrivacySecurity.extension",
      ]);
    });
  }

  async openInputSettings(): Promise<void> {
    await execFileAsync("open", [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    ]).catch(async () => {
      await execFileAsync("open", ["x-apple.systempreferences:com.apple.preference.security"]);
    });
  }

  async listDisplays(): Promise<DesktopDisplayInfo[]> {
    try {
      const electron = await import("electron");
      const primaryId = electron.screen.getPrimaryDisplay().id;
      return electron.screen.getAllDisplays().map((d) =>
        electronDisplayToMetrics({
          id: d.id,
          label: d.label,
          size: d.size,
          scaleFactor: d.scaleFactor,
          bounds: d.bounds,
          isPrimary: d.id === primaryId,
        }),
      );
    } catch {
      // Single virtual display when Electron screen unavailable (unit env)
      return [
        {
          id: "0",
          label: "Main",
          width: 1920,
          height: 1080,
          scaleFactor: 1,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          isPrimary: true,
        },
      ];
    }
  }

  async captureDisplay(
    displayId: string,
    opts?: CaptureDisplayOpts,
  ): Promise<CaptureResult> {
    const displays = await this.listDisplays();
    const d =
      displays.find((x) => x.id === displayId) ??
      displays.find((x) => x.isPrimary) ??
      displays[0];
    if (!d) throw new Error("No display");

    const thumbW = opts?.targetWidth ?? d.width;
    const thumbH = opts?.targetHeight ?? d.height;

    // Prefer Electron desktopCapturer at model resolution when possible
    try {
      const electron = await import("electron");
      const sources = await electron.desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: thumbW,
          height: thumbH,
        },
      });
      // Match by display_id if present in source
      const src =
        sources.find((s) => s.display_id === displayId) ??
        sources.find((s) => s.id.includes(displayId)) ??
        sources[0];
      if (src?.thumbnail && !src.thumbnail.isEmpty()) {
        const png = src.thumbnail.toPNG();
        return {
          bytes: png,
          mime: "image/png",
          // Always map using physical display size, not thumbnail size
          deviceWidth: d.width,
          deviceHeight: d.height,
          scaleFactor: d.scaleFactor,
          bounds: d.bounds, // DIP
        };
      }
    } catch {
      // fall through to screencapture
    }

    const file = join(tmpdir(), `grokdesk-cap-${randomBytes(8).toString("hex")}.png`);
    try {
      await execFileAsync("screencapture", ["-x", "-C", file]);
      const bytes = await readFile(file);
      return {
        bytes,
        mime: "image/png",
        deviceWidth: d.width,
        deviceHeight: d.height,
        scaleFactor: d.scaleFactor,
        bounds: d.bounds,
      };
    } finally {
      await unlink(file).catch(() => {});
    }
  }

  private async py(code: string): Promise<void> {
    this.lastInjectAt = Date.now();
    const file = join(tmpdir(), `grokdesk-in-${randomBytes(8).toString("hex")}.py`);
    await writeFile(file, code, "utf8");
    try {
      await execFileAsync("python3", [file], { timeout: 15_000 });
    } finally {
      await unlink(file).catch(() => {});
    }
  }

  async mouseMove(screenX: number, screenY: number): Promise<void> {
    await this.py(`
import ctypes, ctypes.util
cg = ctypes.CDLL(ctypes.util.find_library("CoreGraphics"))
cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
cg.CFRelease.argtypes = [ctypes.c_void_p]
kCGEventMouseMoved = 5
kCGHIDEventTap = 0
kCGMouseButtonLeft = 0
e = cg.CGEventCreateMouseEvent(None, kCGEventMouseMoved, ctypes.c_double(${screenX}), ctypes.c_double(${screenY}), kCGMouseButtonLeft)
cg.CGEventPost(kCGHIDEventTap, e)
cg.CFRelease(e)
`);
  }

  async mouseClick(opts: {
    screenX: number;
    screenY: number;
    button: "left" | "right" | "middle";
    count: number;
  }): Promise<void> {
    const { down, up, btn } = cgEventTypesForButton(opts.button);
    await this.py(`
import ctypes, ctypes.util, time
cg = ctypes.CDLL(ctypes.util.find_library("CoreGraphics"))
cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
cg.CGEventSetIntegerValueField.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int64]
cg.CFRelease.argtypes = [ctypes.c_void_p]
kCGHIDEventTap = 0
x, y = ${opts.screenX}.0, ${opts.screenY}.0
btn = ${btn}
for i in range(${opts.count}):
    d = cg.CGEventCreateMouseEvent(None, ${down}, ctypes.c_double(x), ctypes.c_double(y), btn)
    cg.CGEventSetIntegerValueField(d, 1, i+1)  # clickState
    cg.CGEventPost(kCGHIDEventTap, d)
    cg.CFRelease(d)
    u = cg.CGEventCreateMouseEvent(None, ${up}, ctypes.c_double(x), ctypes.c_double(y), btn)
    cg.CGEventSetIntegerValueField(u, 1, i+1)
    cg.CGEventPost(kCGHIDEventTap, u)
    cg.CFRelease(u)
    time.sleep(0.05)
`);
  }

  async mouseDrag(opts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    durationMs: number;
  }): Promise<void> {
    await this.py(`
import ctypes, ctypes.util, time
cg = ctypes.CDLL(ctypes.util.find_library("CoreGraphics"))
cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
cg.CFRelease.argtypes = [ctypes.c_void_p]
kCGHIDEventTap = 0
steps = max(5, int(${opts.durationMs} / 16))
cg.CGEventPost(kCGHIDEventTap, cg.CGEventCreateMouseEvent(None, 1, ctypes.c_double(${opts.x1}), ctypes.c_double(${opts.y1}), 0))
for i in range(1, steps+1):
    t = i/steps
    x = ${opts.x1} + (${opts.x2}-${opts.x1})*t
    y = ${opts.y1} + (${opts.y2}-${opts.y1})*t
    e = cg.CGEventCreateMouseEvent(None, 6, ctypes.c_double(x), ctypes.c_double(y), 0)  # dragged
    cg.CGEventPost(kCGHIDEventTap, e)
    cg.CFRelease(e)
    time.sleep(${opts.durationMs}/1000.0/steps)
e = cg.CGEventCreateMouseEvent(None, 2, ctypes.c_double(${opts.x2}), ctypes.c_double(${opts.y2}), 0)
cg.CGEventPost(kCGHIDEventTap, e)
cg.CFRelease(e)
`);
  }

  async typeText(text: string): Promise<void> {
    // Escape for AppleScript double-quoted string; drop NULs that break -e.
    const escaped = escapeAppleScriptString(text);
    this.lastInjectAt = Date.now();
    await execFileAsync("osascript", [
      "-e",
      `tell application "System Events" to keystroke "${escaped}"`,
    ]);
  }

  async key(opts: { key: string; modifiers: string[] }): Promise<void> {
    const keyCode = macKeyCode(opts.key);
    const mods = opts.modifiers
      .map((m) => {
        if (m === "cmd") return "command down";
        if (m === "ctrl") return "control down";
        if (m === "alt") return "option down";
        if (m === "shift") return "shift down";
        return "";
      })
      .filter(Boolean);
    this.lastInjectAt = Date.now();
    if (keyCode != null) {
      const using = mods.length
        ? ` using {${mods.join(", ")}}`
        : "";
      await execFileAsync("osascript", [
        "-e",
        `tell application "System Events" to key code ${keyCode}${using}`,
      ]);
      return;
    }
    const ch = opts.key.length === 1 ? opts.key : "";
    if (!ch) throw new Error(`Unknown key: ${opts.key}`);
    const using = mods.length ? ` using {${mods.join(", ")}}` : "";
    await execFileAsync("osascript", [
      "-e",
      `tell application "System Events" to keystroke "${escapeAppleScriptString(ch)}"${using}`,
    ]);
  }

  async scroll(opts: {
    screenX: number;
    screenY: number;
    dx: number;
    dy: number;
  }): Promise<void> {
    await this.mouseMove(opts.screenX, opts.screenY);
    const linesY = Math.round(opts.dy / 100) || (opts.dy < 0 ? -1 : opts.dy > 0 ? 1 : 0);
    const linesX = Math.round(opts.dx / 100) || (opts.dx < 0 ? -1 : opts.dx > 0 ? 1 : 0);
    await this.py(`
import ctypes, ctypes.util
cg = ctypes.CDLL(ctypes.util.find_library("CoreGraphics"))
cg.CGEventCreateScrollWheelEvent.restype = ctypes.c_void_p
cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
cg.CFRelease.argtypes = [ctypes.c_void_p]
# unit line=0
e = cg.CGEventCreateScrollWheelEvent(None, 0, 2, ${-linesY}, ${-linesX})
cg.CGEventPost(0, e)
cg.CFRelease(e)
`);
  }

  async openApp(opts: { name?: string; path?: string }): Promise<void> {
    if (opts.path) {
      await execFileAsync("open", [opts.path]);
      return;
    }
    if (opts.name) {
      await execFileAsync("open", ["-a", opts.name]);
      return;
    }
    throw new Error("name or path required");
  }

  async getFrontmost(): Promise<{ app: string | null; title: string | null }> {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ]);
      const app = stdout.trim() || null;
      let title: string | null = null;
      try {
        const t = await execFileAsync("osascript", [
          "-e",
          'tell application "System Events" to get name of first window of (first application process whose frontmost is true)',
        ]);
        title = t.stdout.trim() || null;
      } catch {
        title = null;
      }
      return { app, title };
    } catch {
      return { app: null, title: null };
    }
  }

  async getCursorPosition(): Promise<{ x: number; y: number } | null> {
    try {
      const { stdout } = await execFileAsync("python3", [
        "-c",
        `import Quartz; p=Quartz.CGEventGetLocation(Quartz.CGEventCreate(None)); print(int(p.x), int(p.y))`,
      ]);
      const [x, y] = stdout.trim().split(/\s+/).map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } catch {
      try {
        const { stdout } = await execFileAsync("python3", [
          "-c",
          `
import ctypes, ctypes.util
cg = ctypes.CDLL(ctypes.util.find_library("CoreGraphics"))
class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
cg.CGEventCreate.restype = ctypes.c_void_p
cg.CGEventGetLocation.restype = CGPoint
cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]
e = cg.CGEventCreate(None)
p = cg.CGEventGetLocation(e)
print(int(p.x), int(p.y))
`,
        ]);
        const [x, y] = stdout.trim().split(/\s+/).map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      } catch {
        return null;
      }
    }
    return null;
  }

  startYieldMonitor(onYield: () => void): () => void {
    let stopped = false;
    let baseline: { x: number; y: number } | null = null;
    const tick = async () => {
      if (stopped) return;
      const pos = await this.getCursorPosition();
      if (!pos) {
        timer = setTimeout(() => void tick(), 80);
        return;
      }
      if (!baseline) {
        baseline = pos;
        timer = setTimeout(() => void tick(), 80);
        return;
      }
      const dx = Math.abs(pos.x - baseline.x);
      const dy = Math.abs(pos.y - baseline.y);
      const sinceInject = Date.now() - this.lastInjectAt;
      // Ignore our own inject jitter within 40ms
      if (sinceInject > 40 && (dx > 8 || dy > 8)) {
        onYield();
        return;
      }
      // Update baseline slowly if we injected recently
      if (sinceInject < 40) baseline = pos;
      timer = setTimeout(() => void tick(), 80);
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(() => void tick(), 80);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
}

/**
 * Escape text for an AppleScript double-quoted string passed via osascript -e.
 * Drops NULs; escapes \, ", CR, LF, TAB so keystroke cannot break the script.
 */
export function escapeAppleScriptString(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function macKeyCode(key: string): number | null {
  const map: Record<string, number> = {
    enter: 36,
    tab: 48,
    space: 49,
    delete: 51,
    backspace: 51,
    escape: 53,
    left: 123,
    right: 124,
    down: 125,
    up: 126,
    home: 115,
    end: 119,
    pageup: 116,
    pagedown: 121,
    f1: 122,
    f2: 120,
    f3: 99,
    f4: 118,
    f5: 96,
    f6: 97,
    f7: 98,
    f8: 100,
    f9: 101,
    f10: 109,
    f11: 103,
    f12: 111,
  };
  return map[key] ?? null;
}
