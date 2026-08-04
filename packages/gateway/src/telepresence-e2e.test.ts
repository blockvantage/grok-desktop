/**
 * P1 e2e: real RemoteSessionHost + real relay + TelepresenceService with mock HostBridge.
 * Scripted phone starts telepresence, receives sealed frame, taps, quality change, revoke teardown.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  b64uDecode,
  b64uEncode,
  decodePairingQr,
  deriveControlKeys,
  derivePairFrameKey,
  generateX25519KeyPair,
  openFrame,
  parseControlPlain,
  parseJsonBytes,
  PairAcceptPlainSchema,
  qualityConstraints,
  qualityDiffers,
  sealFrame,
  serializeControlPlain,
  serializeJson,
  teleChannel,
  type TeleFramePlain,
} from "@grokdesk/shared";
import { TestEngine } from "@grokdesk/engine-testkit";
import type { HostBridge } from "./host-bridge.js";
import { Gateway } from "./index.js";
import { createRelayServer } from "../../../services/remote-relay/src/index.js";

const SCRATCH =
  process.env.GROK_SCRATCH ||
  path.join(os.tmpdir(), "grok-telepresence-e2e");

function elog(line: string) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.appendFileSync(path.join(SCRATCH, "p1-telepresence-e2e.log"), line + "\n");
}

function waitWsOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function onceMessage(
  ws: WebSocket,
  pred: (msg: Record<string, unknown>) => boolean,
  ms = 20_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const onMsg = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        if (pred(msg)) {
          clearTimeout(t);
          ws.off("message", onMsg);
          resolve(msg);
        }
      } catch {
        /* ignore */
      }
    };
    ws.on("message", onMsg);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mockHostBridge(
  clicks: Array<{ x: number; y: number }>,
  tools: string[] = [],
  drags: Array<Record<string, unknown>> = [],
  scrolls: Array<Record<string, unknown>> = [],
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
      if (req.tool === "desktop_screenshot") {
        return {
          ok: true,
          output: "shot",
          screenshot:
            "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
          width: 200,
          height: 100,
          displayId: "primary",
        };
      }
      if (req.tool === "desktop_click") {
        clicks.push({
          x: Number(req.args.x),
          y: Number(req.args.y),
        });
        return { ok: true, output: "click" };
      }
      if (req.tool === "desktop_drag") {
        drags.push({ ...req.args });
        return { ok: true, output: "drag" };
      }
      if (req.tool === "desktop_scroll") {
        scrolls.push({ ...req.args });
        return { ok: true, output: "scroll" };
      }
      return { ok: true, output: req.tool };
    },
    async desktopConfigure() {},
    async desktopGetStatus() {
      return null;
    },
    async desktopDestroy() {},
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

describe("P1 telepresence e2e via shipped host", () => {
  let relay: ReturnType<typeof createRelayServer>;
  let port: number;
  let dataDir: string;
  let gw: Gateway;
  const clicks: Array<{ x: number; y: number }> = [];
  const tools: string[] = [];
  const drags: Array<Record<string, unknown>> = [];
  const scrolls: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(path.join(SCRATCH, "p1-telepresence-e2e.log"), "");
    relay = createRelayServer({ port: 0, host: "127.0.0.1" });
    ({ port } = await relay.start());
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-p1-"));
    gw = new Gateway(
      {
        dataDir,
        dbPath: path.join(dataDir, "db.sqlite"),
        logsDir: path.join(dataDir, "logs"),
      },
      {
        engine: new TestEngine(),
        machineId: "e2e-machine",
        hostBridge: mockHostBridge(clicks, tools, drags, scrolls),
      },
    );
    await gw.start();
  }, 60_000);

  afterAll(async () => {
    await gw?.stop().catch(() => {});
    await relay?.stop().catch(() => {});
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("start → sealed frame → tap input → quality → revoke teardown", async () => {
    expect(qualityDiffers("smooth", "crisp")).toBe(true);
    const smooth = qualityConstraints("smooth");
    const crisp = qualityConstraints("crisp");
    expect(crisp.maxLongEdge).toBeGreaterThan(smooth.maxLongEdge);
    elog(`presets smooth.long=${smooth.maxLongEdge} crisp.long=${crisp.maxLongEdge}`);

    const relayUrl = `ws://127.0.0.1:${port}/v1`;
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) =>
      r.json(),
    );
    fs.writeFileSync(
      path.join(SCRATCH, "relay-health.json"),
      JSON.stringify(health, null, 2),
    );
    expect((health as { ok: boolean }).ok).toBe(true);

    await gw.handle({
      id: "en",
      method: "remote.enable",
      params: { relayUrl },
    } as never);
    for (let i = 0; i < 50; i++) {
      if (gw.remoteSession?.isRelayReady()) break;
      await sleep(100);
    }
    expect(gw.remoteSession?.isRelayReady()).toBe(true);

    const pairing = (await gw.handle({
      id: "p",
      method: "remote.pairing.start",
      params: { ttlMs: 120_000 },
    } as never)) as { qrString: string };
    const qr = decodePairingQr(pairing.qrString);

    const phone = generateX25519KeyPair();
    const deviceId = "phone-p1";
    const phoneWs = new WebSocket(relayUrl);
    await waitWsOpen(phoneWs);
    phoneWs.send(
      JSON.stringify({
        type: "hello",
        role: "phone",
        machineId: qr.mid,
        deviceId,
        token: "tmp-" + deviceId,
      }),
    );
    await onceMessage(phoneWs, (m) => m.type === "hello_ok");
    const pairKey = derivePairFrameKey(b64uDecode(qr.secret));
    phoneWs.send(
      JSON.stringify({
        type: "send",
        channel: `pair:${qr.mid}`,
        blob: b64uEncode(
          sealFrame(
            pairKey,
            serializeJson({
              v: 1,
              kind: "pair_offer",
              deviceId,
              deviceLabel: "P1 Phone",
              devicePub: b64uEncode(phone.publicKey),
              pairSecret: qr.secret,
            }),
          ),
        ),
      }),
    );
    const acceptMsg = await onceMessage(
      phoneWs,
      (m) => m.type === "recv" && String(m.channel).startsWith("pair:"),
    );
    const accept = PairAcceptPlainSchema.parse(
      parseJsonBytes(openFrame(pairKey, b64uDecode(String(acceptMsg.blob)))),
    );
    const { frameKey } = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: b64uDecode(accept.machinePub),
      pairSecret: b64uDecode(qr.secret),
    });
    phoneWs.close();

    const phoneWs2 = new WebSocket(relayUrl);
    await waitWsOpen(phoneWs2);
    phoneWs2.send(
      JSON.stringify({
        type: "hello",
        role: "phone",
        machineId: qr.mid,
        deviceId,
        token: accept.deviceToken,
      }),
    );
    await onceMessage(phoneWs2, (m) => m.type === "hello_ok");

    async function rpc(method: string, params: unknown = {}) {
      const id = `r-${Math.random().toString(36).slice(2)}`;
      phoneWs2.send(
        JSON.stringify({
          type: "send",
          channel: accept.channel,
          blob: b64uEncode(
            sealFrame(
              frameKey,
              serializeControlPlain({ t: "req", id, method, params }),
            ),
          ),
        }),
      );
      const resp = await onceMessage(phoneWs2, (m) => {
        if (m.type !== "recv" || String(m.channel) !== accept.channel) return false;
        try {
          const opened = parseControlPlain(
            openFrame(frameKey, b64uDecode(String(m.blob))),
          );
          return opened.t === "res" && opened.id === id;
        } catch {
          return false;
        }
      });
      const opened = parseControlPlain(
        openFrame(frameKey, b64uDecode(String(resp.blob))),
      );
      if (opened.t !== "res" || !opened.ok) {
        throw new Error(
          opened.t === "res" && !opened.ok ? opened.error : "bad res",
        );
      }
      return opened.result;
    }

    const teleCh = teleChannel(qr.mid, deviceId);
    const frameWait = onceMessage(
      phoneWs2,
      (m) => m.type === "recv" && String(m.channel) === teleCh,
      15_000,
    );

    const st = (await rpc("remote.telepresence.start", {
      deviceId,
      quality: "smooth",
    })) as { active: boolean; quality: string };
    expect(st.active).toBe(true);
    expect(st.quality).toBe("smooth");
    elog("telepresence start active");

    // Force a capture if timer hasn't fired
    await gw.telepresence.captureOnce();

    const frameMsg = await frameWait;
    // Sealed blob must not contain jpeg magic as raw ascii of full image path labels
    expect(String(frameMsg.blob).includes("P1 Phone")).toBe(false);
    const frame = parseJsonBytes(
      openFrame(frameKey, b64uDecode(String(frameMsg.blob))),
    ) as TeleFramePlain;
    expect(frame.kind).toBe("frame");
    expect(frame.dataB64.length).toBeGreaterThan(10);
    expect(frame.width).toBe(200);
    elog(`frame seq=${frame.seq} ${frame.width}x${frame.height}`);

    await rpc("remote.telepresence.input", {
      kind: "tap",
      nx: 0.5,
      ny: 0.5,
    });
    expect(clicks.length).toBeGreaterThanOrEqual(1);
    expect(clicks[0]!.x).toBe(100); // 0.5 * (200-1) rounded ≈ 100
    expect(tools).toContain("desktop_click");
    elog(`tap mapped to ${clicks[0]!.x},${clicks[0]!.y}`);

    await rpc("remote.telepresence.input", {
      kind: "drag",
      nx: 0.1,
      ny: 0.1,
      nx2: 0.8,
      ny2: 0.7,
    });
    expect(tools).toContain("desktop_drag");
    expect(drags.length).toBeGreaterThanOrEqual(1);
    expect(drags[0]!.x1).toBe(20);
    expect(drags[0]!.y1).toBe(10);
    elog(`drag ${drags[0]!.x1},${drags[0]!.y1}→${drags[0]!.x2},${drags[0]!.y2}`);

    await rpc("remote.telepresence.input", {
      kind: "scroll",
      nx: 0.5,
      ny: 0.5,
      dx: 0,
      dy: -30,
    });
    expect(tools).toContain("desktop_scroll");
    expect(scrolls.length).toBeGreaterThanOrEqual(1);
    expect(scrolls[0]!.dy).toBe(-30);
    elog(`scroll dy=${scrolls[0]!.dy}`);

    const st2 = (await rpc("remote.telepresence.setQuality", {
      quality: "crisp",
    })) as { quality: string };
    expect(st2.quality).toBe("crisp");
    elog("quality crisp set");

    // Status reflects live session (desk banner source)
    const remoteStatus = (await rpc("remote.status", {})) as {
      telepresence: { active: boolean };
    };
    expect(remoteStatus.telepresence.active).toBe(true);

    await rpc("remote.telepresence.stop", { deviceId });
    expect(gw.telepresence.getState().active).toBe(false);
    elog("stop ok");

    // Restart and revoke while live
    await rpc("remote.telepresence.start", { deviceId, quality: "auto" });
    expect(gw.telepresence.getState().active).toBe(true);
    await gw.handle({
      id: "rev",
      method: "remote.devices.revoke",
      params: { deviceId },
    } as never);
    expect(gw.telepresence.getState().active).toBe(false);
    elog("revoke tears down telepresence");
    elog("P1 E2E PASS");

    phoneWs2.close();
  }, 90_000);
});
