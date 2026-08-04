import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { DesktopDisplayInfo, DesktopPermissionStatus } from "@grokdesk/shared";
import type { CaptureDisplayOpts, CaptureResult, DesktopAdapter } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Windows desktop adapter.
 * Capture via Electron desktopCapturer or PowerShell Graphics.
 * Input via user32 SendInput through PowerShell Add-Type.
 */
export class WinDesktopAdapter implements DesktopAdapter {
  platform = "win32" as const;
  private lastInjectAt = 0;

  async getPermissionStatus(): Promise<DesktopPermissionStatus> {
    // Windows does not use macOS-style TCC for basic capture/input in most builds.
    return {
      captureGranted: true,
      inputGranted: true,
      captureDetail: "windows: capture available (check privacy if capture fails)",
      inputDetail: "windows: SendInput available",
      platform: "win32",
    };
  }

  async openCaptureSettings(): Promise<void> {
    await execFileAsync("cmd", ["/c", "start", "ms-settings:privacy-graphicscapture"]).catch(
      async () => {
        await execFileAsync("cmd", ["/c", "start", "ms-settings:privacy"]);
      },
    );
  }

  async openInputSettings(): Promise<void> {
    await execFileAsync("cmd", ["/c", "start", "ms-settings:easeofaccess-mouse"]);
  }

  async listDisplays(): Promise<DesktopDisplayInfo[]> {
    try {
      const electron = await import("electron");
      const primaryId = electron.screen.getPrimaryDisplay().id;
      return electron.screen.getAllDisplays().map((d) => {
        const sf = d.scaleFactor > 0 ? d.scaleFactor : 1;
        return {
          id: String(d.id),
          label: d.label || `Display ${d.id}`,
          width: Math.round(d.size.width * sf),
          height: Math.round(d.size.height * sf),
          scaleFactor: sf,
          // DIP / logical — Windows Cursor.Position is logical when DPI-aware
          bounds: {
            x: Math.round(d.bounds.x),
            y: Math.round(d.bounds.y),
            width: Math.round(d.bounds.width),
            height: Math.round(d.bounds.height),
          },
          isPrimary: d.id === primaryId,
        };
      });
    } catch {
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

    try {
      const electron = await import("electron");
      const sources = await electron.desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: thumbW, height: thumbH },
      });
      const src =
        sources.find((s) => s.display_id === displayId) ?? sources[0];
      if (src?.thumbnail && !src.thumbnail.isEmpty()) {
        const png = src.thumbnail.toPNG();
        return {
          bytes: png,
          mime: "image/png",
          deviceWidth: d.width,
          deviceHeight: d.height,
          scaleFactor: d.scaleFactor,
          bounds: d.bounds,
        };
      }
    } catch {
      // fall through
    }

    // PowerShell screenshot fallback
    const file = join(tmpdir(), `grokdesk-cap-${randomBytes(8).toString("hex")}.png`);
    const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${file.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;
    await execFileAsync("powershell", ["-NoProfile", "-Command", ps], {
      timeout: 20_000,
    });
    const bytes = await readFile(file);
    await unlink(file).catch(() => {});
    return {
      bytes,
      mime: "image/png",
      deviceWidth: d.width,
      deviceHeight: d.height,
      scaleFactor: d.scaleFactor,
      bounds: d.bounds,
    };
  }

  private async ps(script: string): Promise<string> {
    this.lastInjectAt = Date.now();
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", script],
      { timeout: 15_000 },
    );
    return stdout;
  }

  async mouseMove(screenX: number, screenY: number): Promise<void> {
    await this.ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(screenX)}, ${Math.round(screenY)})
`);
  }

  async mouseClick(opts: {
    screenX: number;
    screenY: number;
    button: "left" | "right" | "middle";
    count: number;
  }): Promise<void> {
    const down =
      opts.button === "right"
        ? "0x0008"
        : opts.button === "middle"
          ? "0x0020"
          : "0x0002";
    const up =
      opts.button === "right"
        ? "0x0010"
        : opts.button === "middle"
          ? "0x0040"
          : "0x0004";
    await this.ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GDMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
"@
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(opts.screenX)}, ${Math.round(opts.screenY)})
for ($i=0; $i -lt ${opts.count}; $i++) {
  [GDMouse]::mouse_event(${down}, 0, 0, 0, 0)
  [GDMouse]::mouse_event(${up}, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 40
}
`);
  }

  async mouseDrag(opts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    durationMs: number;
  }): Promise<void> {
    await this.ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GDMouse2 {
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
"@
Add-Type -AssemblyName System.Windows.Forms
$steps = [Math]::Max(5, [int](${opts.durationMs}/16))
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(opts.x1)}, ${Math.round(opts.y1)})
[GDMouse2]::mouse_event(0x0002, 0, 0, 0, 0)
for ($i=1; $i -le $steps; $i++) {
  $t = $i / $steps
  $x = [int](${opts.x1} + (${opts.x2}-${opts.x1})*$t)
  $y = [int](${opts.y1} + (${opts.y2}-${opts.y1})*$t)
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
  Start-Sleep -Milliseconds ([Math]::Max(1, ${opts.durationMs}/$steps))
}
[GDMouse2]::mouse_event(0x0004, 0, 0, 0, 0)
`);
  }

  async typeText(text: string): Promise<void> {
    // Escape SendKeys specials first, then PowerShell single-quoted string.
    const escaped = escapePowerShellSingleQuoted(escapeSendKeysText(text));
    await this.ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
`);
  }

  async key(opts: { key: string; modifiers: string[] }): Promise<void> {
    const parts: string[] = [];
    for (const m of opts.modifiers) {
      if (m === "ctrl" || m === "cmd") parts.push("^");
      if (m === "alt") parts.push("%");
      if (m === "shift") parts.push("+");
    }
    const sendKey = winSendKey(opts.key);
    // sendKey is from a fixed map / single-char escape — still PS-quote for safety.
    const payload = escapePowerShellSingleQuoted(`${parts.join("")}${sendKey}`);
    await this.ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${payload}')
`);
  }

  async scroll(opts: {
    screenX: number;
    screenY: number;
    dx: number;
    dy: number;
  }): Promise<void> {
    const wheel = Math.round(-opts.dy);
    await this.ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GDWheel {
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
}
"@
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(opts.screenX)}, ${Math.round(opts.screenY)})
[GDWheel]::mouse_event(0x0800, 0, 0, ${wheel}, 0)
`);
  }

  async openApp(opts: { name?: string; path?: string }): Promise<void> {
    // Prefer Start-Process with single-quoted paths/names. Never pass
    // user-controlled strings through `cmd /c start` — cmd interprets & | > etc.
    if (opts.path) {
      const p = escapePowerShellSingleQuoted(opts.path);
      await this.ps(`Start-Process -LiteralPath '${p}'`);
      return;
    }
    if (opts.name) {
      const n = escapePowerShellSingleQuoted(opts.name);
      // FileName for apps on PATH / registered app names; LiteralPath for bare paths.
      await this.ps(`Start-Process -FilePath '${n}'`);
      return;
    }
    throw new Error("name or path required");
  }

  async getFrontmost(): Promise<{ app: string | null; title: string | null }> {
    try {
      const out = await this.ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class GDWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$h = [GDWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][GDWin]::GetWindowText($h, $sb, $sb.Capacity)
$pid = 0
[void][GDWin]::GetWindowThreadProcessId($h, [ref]$pid)
$p = Get-Process -Id $pid -ErrorAction SilentlyContinue
Write-Output (($p.ProcessName) + "|" + $sb.ToString())
`);
      const [app, ...rest] = out.trim().split("|");
      return { app: app || null, title: rest.join("|") || null };
    } catch {
      return { app: null, title: null };
    }
  }

  async getCursorPosition(): Promise<{ x: number; y: number } | null> {
    try {
      const out = await this.ps(`
Add-Type -AssemblyName System.Windows.Forms
$p = [System.Windows.Forms.Cursor]::Position
Write-Output ("$($p.X) $($p.Y)")
`);
      const [x, y] = out.trim().split(/\s+/).map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } catch {
      return null;
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
      if (sinceInject > 40 && (dx > 8 || dy > 8)) {
        onYield();
        return;
      }
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
 * Escape characters that SendKeys treats as modifiers/grouping so literal
 * typing cannot inject Ctrl/Alt/Shift sequences (e.g. password "a+b" or "%{F4}").
 * Export for unit tests — keep in sync with Microsoft SendKeys syntax.
 */
export function escapeSendKeysText(text: string): string {
  // Brace each special: + ^ % ~ ( ) { } [ ]
  return text.replace(/([+^%~(){}[\]])/g, "{$1}");
}

/** Double single quotes for PowerShell single-quoted string literals. */
export function escapePowerShellSingleQuoted(text: string): string {
  return text.replace(/'/g, "''");
}

function winSendKey(key: string): string {
  const map: Record<string, string> = {
    enter: "{ENTER}",
    tab: "{TAB}",
    escape: "{ESC}",
    backspace: "{BACKSPACE}",
    delete: "{DELETE}",
    space: " ",
    up: "{UP}",
    down: "{DOWN}",
    left: "{LEFT}",
    right: "{RIGHT}",
    home: "{HOME}",
    end: "{END}",
    pageup: "{PGUP}",
    pagedown: "{PGDN}",
  };
  if (map[key]) return map[key];
  if (/^f([1-9]|1[0-2])$/.test(key)) return `{${key.toUpperCase()}}`;
  if (key.length === 1) {
    return escapeSendKeysText(key);
  }
  // Refuse free-form multi-char keys — previously returned raw strings that
  // could inject SendKeys chord sequences from untrusted telepresence/agent input.
  throw new Error(`Unknown key: ${key}`);
}
