/**
 * Desk telepresence: capture loop + input via HostBridge, sealed frames out.
 */
import type { HostBridge } from "../host-bridge.js";
import type { SettingsService } from "./settings.js";
import {
  DEFAULT_TELEPRESENCE_TTL_MS,
  emptyTelepresenceState,
  phoneViewToImageCoords,
  qualityConstraints,
  type DesktopDisplayInfo,
  type TeleFramePlain,
  type TelepresenceInputEvent,
  type TelepresenceQuality,
  type TelepresenceSessionState,
} from "@grokdesk/shared";
import { randomUUID } from "node:crypto";

const TELE_TASK_ID = "remote-telepresence";

export type TelepresenceFrameSink = (
  deviceId: string,
  frame: TeleFramePlain,
) => boolean | void;

export class TelepresenceService {
  private state: TelepresenceSessionState = emptyTelepresenceState();
  private timer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private capturing = false;
  private frameSink: TelepresenceFrameSink | null = null;
  private listeners = new Set<(s: TelepresenceSessionState) => void>();

  constructor(
    private hostBridge: HostBridge,
    private settings: SettingsService,
  ) {}

  setFrameSink(sink: TelepresenceFrameSink | null): void {
    this.frameSink = sink;
  }

  onState(listener: (s: TelepresenceSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): TelepresenceSessionState {
    return { ...this.state };
  }

  private emit() {
    const snap = this.getState();
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch {
        /* ignore */
      }
    }
  }

  async start(opts: {
    deviceId: string;
    quality?: TelepresenceQuality;
    displayId?: string | null;
    /** TTL ms; defaults to DEFAULT_TELEPRESENCE_TTL_MS. */
    ttlMs?: number;
    /** Desktop consent; remote start implies granted after desk enable. */
    consent?: "granted" | "pending";
  }): Promise<TelepresenceSessionState> {
    await this.stop();
    const quality = opts.quality ?? "auto";
    const constraints = qualityConstraints(quality);
    const machine = {
      ...this.settings.getAll().desktopControl,
      enabled: true,
      maxScreenshotLongEdge: constraints.maxLongEdge,
      screenshotFormat: "jpeg" as const,
      screenshotJpegQuality: constraints.jpegQuality,
    };
    await this.hostBridge.desktopConfigure({
      taskId: TELE_TASK_ID,
      granted: true,
      displayId: opts.displayId ?? machine.defaultDisplayId,
      machine,
      clearSoftPause: true,
    });

    const now = Date.now();
    const ttl = opts.ttlMs ?? DEFAULT_TELEPRESENCE_TTL_MS;
    const sessionId = randomUUID();
    this.state = {
      active: true,
      deviceId: opts.deviceId,
      sessionId,
      quality,
      displayId: opts.displayId ?? machine.defaultDisplayId,
      imageW: 0,
      imageH: 0,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      consent: opts.consent ?? "granted",
      lastError: null,
      framesSent: 0,
      framesDropped: 0,
      lastDropReason: null,
    };
    this.seq = 0;
    this.emit();

    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => {
      void this.expire("ttl");
    }, ttl);
    this.expiryTimer.unref?.();

    const intervalMs = Math.max(50, Math.round(1000 / constraints.fps));
    this.timer = setInterval(() => {
      void this.captureOnce();
    }, intervalMs);
    // First frame ASAP
    void this.captureOnce();
    return this.getState();
  }

  /** Mark consent denied / expired and tear down. */
  async expire(reason: "ttl" | "consent_revoked" | "denied"): Promise<void> {
    if (!this.state.active) return;
    this.state = {
      ...this.state,
      consent: reason === "ttl" ? "expired" : "denied",
      lastError:
        reason === "ttl"
          ? "Telepresence session expired"
          : "Telepresence consent revoked",
    };
    this.emit();
    await this.stop();
  }

  async setQuality(quality: TelepresenceQuality): Promise<TelepresenceSessionState> {
    if (!this.state.active || !this.state.deviceId) {
      throw new Error("Telepresence not active");
    }
    return this.start({
      deviceId: this.state.deviceId,
      quality,
      displayId: this.state.displayId,
    });
  }

  /**
   * List host displays for multi-display picker (P3).
   * Uses desktop_list_displays via HostBridge; empty array when host unavailable.
   */
  async listDisplays(): Promise<DesktopDisplayInfo[]> {
    const result = await this.hostBridge.desktopExec({
      taskId: TELE_TASK_ID,
      tool: "desktop_list_displays",
      args: {},
    });
    if (!result.ok) {
      // Soft-fail: phone can still start default display
      return [];
    }
    return Array.isArray(result.displays) ? result.displays : [];
  }

  /** Switch capture target while keeping quality/device (restart capture loop). */
  async setDisplay(displayId: string | null): Promise<TelepresenceSessionState> {
    if (!this.state.active || !this.state.deviceId) {
      throw new Error("Telepresence not active");
    }
    return this.start({
      deviceId: this.state.deviceId,
      quality: this.state.quality,
      displayId,
    });
  }

  async stop(): Promise<TelepresenceSessionState> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    this.capturing = false;
    try {
      await this.hostBridge.desktopDestroy(TELE_TASK_ID);
    } catch {
      /* ignore */
    }
    // Preserve final drop metrics briefly? empty resets — metrics are for active session.
    this.state = emptyTelepresenceState();
    this.emit();
    return this.getState();
  }

  /** Tear down if owned by device (revoke path). */
  async stopIfDevice(deviceId: string): Promise<void> {
    if (this.state.active && this.state.deviceId === deviceId) {
      await this.stop();
    }
  }

  /** Public for tests / forced refresh. */
  async captureOnce(): Promise<void> {
    if (!this.state.active || !this.state.deviceId || this.capturing) return;
    this.capturing = true;
    try {
      const result = await this.hostBridge.desktopExec({
        taskId: TELE_TASK_ID,
        tool: "desktop_screenshot",
        args: this.state.displayId
          ? { displayId: this.state.displayId }
          : {},
      });
      if (!result.ok || !result.screenshot) {
        this.state = {
          ...this.state,
          lastError:
            result.output ||
            result.code ||
            "Screenshot failed — check Screen Recording permission",
        };
        this.emit();
        return;
      }
      const dataUrl = result.screenshot;
      const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/i.exec(dataUrl);
      if (!m) {
        this.state = {
          ...this.state,
          lastError: "Unexpected screenshot format",
        };
        this.emit();
        return;
      }
      const mime = m[1]!.toLowerCase() as "image/jpeg" | "image/png";
      const dataB64 = m[2]!;
      const width = result.width ?? 0;
      const height = result.height ?? 0;

      // Always update local geometry for pointer mapping, even if we drop delivery.
      this.state = {
        ...this.state,
        imageW: width,
        imageH: height,
        displayId: this.state.displayId ?? result.displayId ?? null,
        lastError: null,
      };

      // Expiry / consent gate before remote delivery.
      if (
        this.state.expiresAt &&
        Date.now() > Date.parse(this.state.expiresAt)
      ) {
        this.emit();
        void this.expire("ttl");
        return;
      }
      if (this.state.consent !== "granted") {
        this.recordDrop("consent_not_granted");
        return;
      }

      this.seq += 1;
      const frame: TeleFramePlain = {
        v: 1,
        kind: "frame",
        seq: this.seq,
        mime,
        dataB64,
        width,
        height,
        displayId: this.state.displayId ?? result.displayId ?? undefined,
        ts: Date.now(),
      };

      // Bound frame size — drop rather than storm the relay.
      if (dataB64.length > 340_000) {
        this.recordDrop("frame_too_large");
        return;
      }

      // No sink: local capture still useful for desk/input; not a remote drop.
      if (!this.frameSink || !this.state.deviceId) {
        this.emit();
        return;
      }
      let delivered = true;
      try {
        const r = this.frameSink(this.state.deviceId, frame);
        if (r === false) delivered = false;
      } catch {
        delivered = false;
      }
      this.state = {
        ...this.state,
        framesSent: delivered
          ? this.state.framesSent + 1
          : this.state.framesSent,
        framesDropped: delivered
          ? this.state.framesDropped
          : this.state.framesDropped + 1,
        lastDropReason: delivered ? this.state.lastDropReason : "sink_rejected",
      };
      this.emit();
    } catch (e) {
      this.state = {
        ...this.state,
        lastError: e instanceof Error ? e.message : String(e),
      };
      this.emit();
    } finally {
      this.capturing = false;
    }
  }

  /**
   * Remote callers must own the active stream (principal device id).
   * Desktop (no principal) may operate without ownership check when owner is null.
   */
  assertOwner(principalDeviceId: string | null | undefined): void {
    if (!this.state.active) {
      throw new Error("Telepresence not active");
    }
    if (this.state.consent !== "granted") {
      throw new Error("Telepresence consent not granted");
    }
    if (
      this.state.expiresAt &&
      Date.now() > Date.parse(this.state.expiresAt)
    ) {
      throw new Error("Telepresence session expired");
    }
    if (!principalDeviceId) {
      // Desktop path: allowed.
      return;
    }
    if (this.state.deviceId !== principalDeviceId) {
      throw new Error("Telepresence session owned by another device");
    }
  }

  private recordDrop(reason: string): void {
    this.state = {
      ...this.state,
      framesDropped: this.state.framesDropped + 1,
      lastDropReason: reason,
    };
    this.emit();
  }

  async handleInput(
    ev: TelepresenceInputEvent,
    opts?: { principalDeviceId?: string | null },
  ): Promise<{ ok: boolean; output: string }> {
    if (!this.state.active) {
      return { ok: false, output: "Telepresence not active" };
    }
    if (this.state.consent !== "granted") {
      return { ok: false, output: "Telepresence consent not granted" };
    }
    if (
      this.state.expiresAt &&
      Date.now() > Date.parse(this.state.expiresAt)
    ) {
      void this.expire("ttl");
      return { ok: false, output: "Telepresence session expired" };
    }
    if (
      opts?.principalDeviceId != null &&
      opts.principalDeviceId !== "" &&
      this.state.deviceId !== opts.principalDeviceId
    ) {
      return { ok: false, output: "Telepresence session owned by another device" };
    }
    // Pointer tools need a real frame size for letterbox/normalized mapping.
    if (
      (ev.kind === "tap" || ev.kind === "drag" || ev.kind === "scroll") &&
      (this.state.imageW <= 0 || this.state.imageH <= 0)
    ) {
      await this.captureOnce();
    }
    if (
      (ev.kind === "tap" || ev.kind === "drag" || ev.kind === "scroll") &&
      (this.state.imageW <= 0 || this.state.imageH <= 0)
    ) {
      return {
        ok: false,
        output: "No frame yet — wait for capture (permissions / display)",
      };
    }
    const imageW = this.state.imageW;
    const imageH = this.state.imageH;

    const resolvePt = (
      nx?: number,
      ny?: number,
      viewX?: number,
      viewY?: number,
      viewW?: number,
      viewH?: number,
    ): { x: number; y: number } | null => {
      if (typeof nx === "number" && typeof ny === "number") {
        return {
          x: Math.round(nx * (imageW - 1)),
          y: Math.round(ny * (imageH - 1)),
        };
      }
      if (
        typeof viewX === "number" &&
        typeof viewY === "number" &&
        typeof viewW === "number" &&
        typeof viewH === "number"
      ) {
        return phoneViewToImageCoords(
          viewX,
          viewY,
          viewW,
          viewH,
          imageW,
          imageH,
        );
      }
      return null;
    };

    try {
      switch (ev.kind) {
        case "tap": {
          const pt = resolvePt(ev.nx, ev.ny, ev.viewX, ev.viewY, ev.viewW, ev.viewH);
          if (!pt) return { ok: false, output: "tap outside content" };
          const r = await this.hostBridge.desktopExec({
            taskId: TELE_TASK_ID,
            tool: "desktop_click",
            args: {
              x: pt.x,
              y: pt.y,
              button: ev.button ?? "left",
              count: 1,
            },
          });
          return { ok: r.ok, output: r.output };
        }
        case "drag": {
          const a = resolvePt(ev.nx, ev.ny, ev.viewX, ev.viewY, ev.viewW, ev.viewH);
          const b = resolvePt(
            ev.nx2,
            ev.ny2,
            ev.viewX2,
            ev.viewY2,
            ev.viewW,
            ev.viewH,
          );
          if (!a || !b) return { ok: false, output: "drag outside content" };
          const r = await this.hostBridge.desktopExec({
            taskId: TELE_TASK_ID,
            tool: "desktop_drag",
            args: { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
          });
          return { ok: r.ok, output: r.output };
        }
        case "scroll": {
          const pt = resolvePt(ev.nx, ev.ny, ev.viewX, ev.viewY, ev.viewW, ev.viewH) ?? {
            x: Math.round(imageW / 2),
            y: Math.round(imageH / 2),
          };
          const r = await this.hostBridge.desktopExec({
            taskId: TELE_TASK_ID,
            tool: "desktop_scroll",
            args: {
              x: pt.x,
              y: pt.y,
              dx: ev.dx ?? 0,
              dy: ev.dy ?? 0,
            },
          });
          return { ok: r.ok, output: r.output };
        }
        case "key": {
          if (!ev.key) return { ok: false, output: "key required" };
          const r = await this.hostBridge.desktopExec({
            taskId: TELE_TASK_ID,
            tool: "desktop_key",
            args: { key: ev.key },
          });
          return { ok: r.ok, output: r.output };
        }
        case "type": {
          if (!ev.text) return { ok: false, output: "text required" };
          const r = await this.hostBridge.desktopExec({
            taskId: TELE_TASK_ID,
            tool: "desktop_type",
            args: { text: ev.text },
          });
          return { ok: r.ok, output: r.output };
        }
        default:
          return { ok: false, output: "unknown input kind" };
      }
    } catch (e) {
      return {
        ok: false,
        output: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
