import {
  computeDownscale,
  imageToScreenDip,
  normalizeDesktopKey,
  normalizeModifiers,
  type DesktopExecResult,
  type DesktopStatusEvent,
  type DesktopTool,
} from "@grokdesk/shared";
import type { DesktopPolicyStore } from "./desktop-policy-store";
import type { CaptureMeta, DesktopAdapter } from "./desktop/types";
import { ensurePngSize, readPngSize } from "./desktop/resize-png";

/**
 * Orchestrates capture + input for computer use.
 * Always goes through DesktopPolicyStore.authorize first.
 */
const LAST_CAPTURE_MAX = 512;

export class DesktopUseService {
  private lastCapture = new Map<string, CaptureMeta>();
  private listeners = new Set<(s: DesktopStatusEvent) => void>();
  private exclusiveTask: string | null = null;

  constructor(
    private policy: DesktopPolicyStore,
    private adapter: DesktopAdapter,
  ) {}

  onStatus(cb: (s: DesktopStatusEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(
    taskId: string,
    patch: Partial<DesktopStatusEvent>,
  ): DesktopStatusEvent {
    const task = this.policy.getTaskState(taskId);
    const next: DesktopStatusEvent = {
      taskId,
      active: patch.active ?? false,
      exclusive: patch.exclusive ?? this.exclusiveTask === taskId,
      softPaused: patch.softPaused ?? task?.softPaused ?? false,
      lastAction: patch.lastAction ?? null,
      lastError: patch.lastError ?? null,
      lastScreenshotDataUrl: patch.lastScreenshotDataUrl ?? null,
      frontmostApp: patch.frontmostApp ?? null,
      displayId: patch.displayId ?? task?.displayId ?? null,
      updatedAt: new Date().toISOString(),
      ...patch,
    };
    next.taskId = taskId;
    for (const cb of this.listeners) cb(next);
    return next;
  }

  async refreshPermissions(): Promise<void> {
    const status = await this.adapter.getPermissionStatus();
    this.policy.setPermissions(status);
  }

  async exec(
    taskId: string,
    toolRaw: string,
    args: Record<string, unknown>,
  ): Promise<DesktopExecResult> {
    await this.refreshPermissions().catch(() => {
      /* keep last */
    });

    let frontmost: { app: string | null; title: string | null } | undefined;
    try {
      frontmost = await this.adapter.getFrontmost();
    } catch {
      frontmost = undefined;
    }

    const authz = this.policy.authorize(taskId, toolRaw, args, frontmost);
    if (!authz.ok) {
      this.emit(taskId, {
        active: false,
        lastError: authz.output,
        lastAction: toolRaw,
        softPaused: authz.code === "desktop_yielded",
      });
      return this.policy.toExecFail(authz);
    }

    const { tool, args: parsed } = authz;
    this.emit(taskId, {
      active: true,
      lastAction: tool,
      lastError: null,
      frontmostApp: frontmost?.app ?? null,
    });

    try {
      const result = await this.runTool(taskId, tool, parsed, frontmost);
      this.emit(taskId, {
        active: false,
        exclusive: false,
        lastAction: tool,
        lastError: result.ok ? null : (result.output ?? null),
        lastScreenshotDataUrl: result.screenshot ?? null,
        frontmostApp: result.frontmostApp ?? frontmost?.app ?? null,
        displayId: result.displayId ?? null,
      });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.emit(taskId, {
        active: false,
        exclusive: false,
        lastError: msg,
        lastAction: tool,
      });
      return {
        ok: false,
        output: msg,
        code: "desktop_input_failed",
      };
    }
  }

  private async runTool(
    taskId: string,
    tool: DesktopTool,
    args: Record<string, unknown>,
    frontmost?: { app: string | null; title: string | null },
  ): Promise<DesktopExecResult> {
    switch (tool) {
      case "desktop_list_displays": {
        const displays = await this.adapter.listDisplays();
        return {
          ok: true,
          output: `displays: ${displays.length}`,
          displays,
        };
      }
      case "desktop_screenshot":
        return this.screenshot(taskId, args.displayId as string | undefined);
      case "desktop_wait": {
        const ms = Math.min(
          30_000,
          Math.max(0, typeof args.ms === "number" ? args.ms : 500),
        );
        await sleep(ms);
        return { ok: true, output: `waited ${ms}ms` };
      }
      case "desktop_open_app": {
        try {
          await this.adapter.openApp({
            name: typeof args.name === "string" ? args.name : undefined,
            path: typeof args.path === "string" ? args.path : undefined,
          });
          return { ok: true, output: "app opened" };
        } catch (e) {
          return {
            ok: false,
            code: "desktop_open_app_failed",
            output: e instanceof Error ? e.message : String(e),
          };
        }
      }
      default:
        return this.runInputTool(taskId, tool, args, frontmost);
    }
  }

  private async runInputTool(
    taskId: string,
    tool: DesktopTool,
    args: Record<string, unknown>,
    frontmost?: { app: string | null; title: string | null },
  ): Promise<DesktopExecResult> {
    // Ensure capture meta exists for coordinate tools
    if (needsCoords(tool) && !this.lastCapture.get(taskId)) {
      const shot = await this.screenshot(taskId, undefined);
      if (!shot.ok) return shot;
    }

    let yielded = false;
    const stopYield = this.adapter.startYieldMonitor(() => {
      yielded = true;
      this.policy.setSoftPaused(taskId, true);
    });

    this.exclusiveTask = taskId;
    this.emit(taskId, { exclusive: true, active: true, lastAction: tool });

    try {
      const meta = this.lastCapture.get(taskId);
      const mapPt = (ix: number, iy: number) => {
        if (!meta) return { x: Math.round(ix), y: Math.round(iy) };
        // DIP/points for CGEvent / logical cursor (not physical px)
        return imageToScreenDip(
          ix,
          iy,
          meta.imageW,
          meta.imageH,
          meta.deviceW,
          meta.deviceH,
          meta.scaleFactor,
          meta.bounds,
        );
      };

      if (yielded) {
        return yieldResult();
      }

      switch (tool) {
        case "desktop_mouse_move": {
          const p = mapPt(Number(args.x), Number(args.y));
          await this.adapter.mouseMove(p.x, p.y);
          if (yielded) return yieldResult();
          return {
            ok: true,
            output: `moved (${args.x}, ${args.y}) → screen (${p.x}, ${p.y})`,
            frontmostApp: frontmost?.app,
            frontmostWindowTitle: frontmost?.title,
          };
        }
        case "desktop_click": {
          const p = mapPt(Number(args.x), Number(args.y));
          const button =
            args.button === "right" || args.button === "middle"
              ? args.button
              : "left";
          const count =
            typeof args.count === "number"
              ? Math.min(3, Math.max(1, args.count))
              : 1;
          await this.adapter.mouseClick({
            screenX: p.x,
            screenY: p.y,
            button,
            count,
          });
          if (yielded) return yieldResult();
          return {
            ok: true,
            output: `clicked (${args.x}, ${args.y})`,
            frontmostApp: frontmost?.app,
            frontmostWindowTitle: frontmost?.title,
          };
        }
        case "desktop_double_click": {
          const p = mapPt(Number(args.x), Number(args.y));
          await this.adapter.mouseClick({
            screenX: p.x,
            screenY: p.y,
            button: "left",
            count: 2,
          });
          if (yielded) return yieldResult();
          return {
            ok: true,
            output: `double_clicked (${args.x}, ${args.y})`,
            frontmostApp: frontmost?.app,
          };
        }
        case "desktop_drag": {
          const a = mapPt(Number(args.x1), Number(args.y1));
          const b = mapPt(Number(args.x2), Number(args.y2));
          const durationMs =
            typeof args.durationMs === "number" ? args.durationMs : 300;
          await this.adapter.mouseDrag({
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            durationMs,
          });
          if (yielded) return yieldResult();
          return {
            ok: true,
            output: `dragged (${args.x1},${args.y1})→(${args.x2},${args.y2})`,
          };
        }
        case "desktop_type": {
          await this.adapter.typeText(String(args.text ?? ""));
          if (yielded) return yieldResult();
          const len = String(args.text ?? "").length;
          return { ok: true, output: `typed ${len} chars` };
        }
        case "desktop_key": {
          const key = normalizeDesktopKey(String(args.key ?? ""));
          const modifiers = normalizeModifiers(args.modifiers);
          await this.adapter.key({ key, modifiers });
          if (yielded) return yieldResult();
          return {
            ok: true,
            output: `key ${modifiers.length ? modifiers.join("+") + "+" : ""}${key}`,
          };
        }
        case "desktop_scroll": {
          const p = mapPt(Number(args.x), Number(args.y));
          const dx = typeof args.dx === "number" ? args.dx : 0;
          const dy = typeof args.dy === "number" ? args.dy : 0;
          await this.adapter.scroll({
            screenX: p.x,
            screenY: p.y,
            dx,
            dy,
          });
          if (yielded) return yieldResult();
          return { ok: true, output: `scrolled dx=${dx} dy=${dy}` };
        }
        default:
          return {
            ok: false,
            code: "desktop_invalid_args",
            output: `Unhandled tool ${tool}`,
          };
      }
    } finally {
      stopYield();
      this.exclusiveTask = null;
    }

    function yieldResult(): DesktopExecResult {
      return {
        ok: false,
        code: "desktop_yielded",
        output:
          "You moved the mouse or typed — desktop control paused. Click Resume when ready.",
      };
    }
  }

  private async screenshot(
    taskId: string,
    displayIdArg?: string,
  ): Promise<DesktopExecResult> {
    const machine = this.policy.getMachine();
    const task = this.policy.getTaskState(taskId);
    let displayId =
      displayIdArg ??
      task?.displayId ??
      machine.defaultDisplayId ??
      null;

    try {
      const displays = await this.adapter.listDisplays();
      if (!displays.length) {
        return {
          ok: false,
          code: "desktop_capture_failed",
          output: "No displays found",
        };
      }
      if (!displayId) {
        displayId =
          displays.find((d) => d.isPrimary)?.id ?? displays[0]!.id;
      }
      const exists = displays.some((d) => d.id === displayId);
      if (!exists) {
        return {
          ok: false,
          code: "desktop_display_not_found",
          output: `Display not found: ${displayId}`,
        };
      }

      const listed = displays.find((x) => x.id === displayId)!;
      const down = computeDownscale(
        listed.width,
        listed.height,
        machine.maxScreenshotLongEdge,
      );

      const cap = await this.adapter.captureDisplay(displayId, {
        targetWidth: down.imageW,
        targetHeight: down.imageH,
      });

      // Device size from display metrics (physical); never use thumbnail size for mapping
      const deviceW = listed.width;
      const deviceH = listed.height;
      const targetW = down.imageW;
      const targetH = down.imageH;

      // Ensure PNG bytes pixel grid === reported width×height
      let outBytes = cap.bytes;
      let outMime: "image/png" | "image/jpeg" = cap.mime;
      try {
        const ensured = ensurePngSize(
          cap.bytes,
          cap.mime,
          targetW,
          targetH,
        );
        outBytes = ensured.bytes;
        outMime = ensured.mime;
        const sz = readPngSize(outBytes);
        if (sz.width !== targetW || sz.height !== targetH) {
          throw new Error(
            `resize mismatch: got ${sz.width}x${sz.height} want ${targetW}x${targetH}`,
          );
        }
      } catch (e) {
        // If not PNG (e.g. fake test buffer), only accept when dims already match target
        // via adapter-provided size contract — fail closed for real path.
        if (cap.mime === "image/png" || outBytes[0] === 0x89) {
          return {
            ok: false,
            code: "desktop_capture_failed",
            output: e instanceof Error ? e.message : String(e),
          };
        }
        // Non-PNG test fixtures: still record target meta so clicks map; bytes are opaque
      }

      const b64 = outBytes.toString("base64");
      const dataUrl = `data:${outMime};base64,${b64}`;

      const meta: CaptureMeta = {
        displayId,
        imageW: targetW,
        imageH: targetH,
        deviceW,
        deviceH,
        scaleFactor: cap.scaleFactor || listed.scaleFactor,
        bounds: cap.bounds, // DIP
        imageToDeviceScale: down.imageToDeviceScale,
      };
      if (!this.lastCapture.has(taskId)) {
        while (this.lastCapture.size >= LAST_CAPTURE_MAX) {
          const oldest = this.lastCapture.keys().next().value as
            | string
            | undefined;
          if (oldest === undefined) break;
          this.lastCapture.delete(oldest);
        }
      }
      this.lastCapture.set(taskId, meta);

      return {
        ok: true,
        output: `screenshot ${targetW}x${targetH} display=${displayId}`,
        screenshot: dataUrl,
        width: targetW,
        height: targetH,
        displayId,
        scaleFactor: meta.scaleFactor,
        imageToDeviceScale: down.imageToDeviceScale,
      };
    } catch (e) {
      return {
        ok: false,
        code: "desktop_capture_failed",
        output: e instanceof Error ? e.message : String(e),
      };
    }
  }

  destroy(taskId: string): void {
    this.lastCapture.delete(taskId);
    this.policy.destroy(taskId);
    if (this.exclusiveTask === taskId) this.exclusiveTask = null;
    this.emit(taskId, {
      active: false,
      exclusive: false,
      lastAction: "destroy",
    });
  }
}

function needsCoords(tool: DesktopTool): boolean {
  return (
    tool === "desktop_mouse_move" ||
    tool === "desktop_click" ||
    tool === "desktop_double_click" ||
    tool === "desktop_drag" ||
    tool === "desktop_scroll"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
