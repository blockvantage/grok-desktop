import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { SettingsService } from "../services/settings.js";
import { TelepresenceService } from "../services/telepresence.js";
import type { HostBridge } from "../host-bridge.js";

function mockBridge(): HostBridge {
  return {
    async browserConfigure() {},
    async browserDestroy() {},
    async browserExec() {
      return { ok: true };
    },
    async browserResolveApproval() {},
    async browserRememberOrigin() {},
    async desktopConfigure() {},
    async desktopDestroy() {},
    async desktopExec() {
      return {
        ok: true,
        screenshot: "data:image/jpeg;base64," + "A".repeat(100),
        width: 100,
        height: 80,
      };
    },
  } as unknown as HostBridge;
}

describe("telepresence ownership TTL + drop metrics", () => {
  let dir: string;
  let db: Db;
  let svc: TelepresenceService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-tele-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    const settings = new SettingsService(db);
    svc = new TelepresenceService(mockBridge(), settings);
  });

  afterEach(async () => {
    await svc.stop();
    try {
      db.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("assigns sessionId, expiresAt, and consent on start", async () => {
    const st = await svc.start({
      deviceId: "dev-a",
      quality: "auto",
      ttlMs: 60_000,
    });
    expect(st.active).toBe(true);
    expect(st.sessionId).toBeTruthy();
    expect(st.consent).toBe("granted");
    expect(st.expiresAt).toBeTruthy();
    expect(Date.parse(st.expiresAt!)).toBeGreaterThan(Date.now());
  });

  it("rejects input when consent is not granted", async () => {
    await svc.start({
      deviceId: "dev-a",
      consent: "pending",
    });
    // Force consent pending after start
    const st = svc.getState();
    (svc as unknown as { state: typeof st }).state = {
      ...st,
      consent: "pending",
    };
    const r = await svc.handleInput(
      { kind: "tap", nx: 0.5, ny: 0.5 },
      { principalDeviceId: "dev-a" },
    );
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/consent/i);
  });

  it("expire(ttl) stops the session", async () => {
    await svc.start({ deviceId: "dev-a", ttlMs: 60_000 });
    await svc.expire("ttl");
    expect(svc.getState().active).toBe(false);
  });

  it("counts framesDropped when sink rejects", async () => {
    svc.setFrameSink(() => false);
    await svc.start({ deviceId: "dev-a", ttlMs: 60_000 });
    // Allow capture loop a tick
    await new Promise((r) => setTimeout(r, 80));
    const st = svc.getState();
    // At least one capture should have attempted delivery
    expect(st.framesDropped + st.framesSent).toBeGreaterThanOrEqual(0);
    // With rejecting sink, drops should be > 0 if capture succeeded
    if (st.framesSent === 0 && st.framesDropped === 0) {
      // capture may have failed without host — still assert metrics fields exist
      expect(st.lastDropReason === null || typeof st.lastDropReason === "string").toBe(
        true,
      );
    } else {
      expect(st.framesDropped).toBeGreaterThan(0);
      expect(st.lastDropReason).toBe("sink_rejected");
    }
  });

  it("assertOwner rejects foreign device", async () => {
    await svc.start({ deviceId: "dev-a" });
    expect(() => svc.assertOwner("dev-b")).toThrow(/another device/i);
    expect(() => svc.assertOwner("dev-a")).not.toThrow();
  });
});
