/**
 * P2 e2e: real relay + Gateway + shipped RemoteSessionHost.
 * Drives schedule.list/create/setEnabled and memory.list/upsert/delete
 * over the E2E control channel (not a mock RemoteService twin).
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
  sealFrame,
  serializeControlPlain,
  serializeJson,
  isRemoteAllowedMethod,
} from "@grokdesk/shared";
import { TestEngine } from "@grokdesk/engine-testkit";
import { Gateway } from "./index.js";
import { createRelayServer } from "../../../services/remote-relay/src/index.js";

const SCRATCH =
  process.env.GROK_SCRATCH ||
  path.join(os.tmpdir(), "grok-remote-p2-e2e");

function elog(line: string) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.appendFileSync(path.join(SCRATCH, "p2-schedule-memory-e2e.log"), line + "\n");
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

describe("P2 remote schedule + memory e2e via shipped RemoteSessionHost", () => {
  let relay: ReturnType<typeof createRelayServer>;
  let port: number;
  let dataDir: string;
  let gw: Gateway;

  beforeAll(async () => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(path.join(SCRATCH, "p2-schedule-memory-e2e.log"), "");
    relay = createRelayServer({ port: 0, host: "127.0.0.1" });
    ({ port } = await relay.start());
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-p2-e2e-"));
    gw = new Gateway(
      {
        dataDir,
        dbPath: path.join(dataDir, "db.sqlite"),
        logsDir: path.join(dataDir, "logs"),
      },
      { engine: new TestEngine(), machineId: "p2-e2e-machine" },
    );
    await gw.start();
  }, 60_000);

  afterAll(async () => {
    await gw?.stop().catch(() => {});
    await relay?.stop().catch(() => {});
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("pairs then schedule + memory RPCs over E2E control", async () => {
    // Structural proof: allowlist includes P2 methods
    for (const m of [
      "schedule.list",
      "schedule.create",
      "schedule.setEnabled",
      "memory.list",
      "memory.upsert",
      "memory.delete",
    ]) {
      expect(isRemoteAllowedMethod(m)).toBe(true);
      expect(() => gw.remote.assertMethodAllowed(m)).not.toThrow();
    }
    elog("allowlist schedule.* memory.* ok");

    const relayUrl = `ws://127.0.0.1:${port}/v1`;
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
    elog("RemoteSessionHost ready");

    const pairing = (await gw.handle({
      id: "pair",
      method: "remote.pairing.start",
      params: { ttlMs: 120_000 },
    } as never)) as { qrString: string };
    const qr = decodePairingQr(pairing.qrString);

    const phone = generateX25519KeyPair();
    const deviceId = "phone-p2-1";
    const phoneWs = new WebSocket(relayUrl);
    await waitWsOpen(phoneWs);
    phoneWs.send(
      JSON.stringify({
        type: "hello",
        role: "phone",
        machineId: qr.mid,
        deviceId,
        token: "pairing-temp-" + deviceId,
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
              deviceLabel: "P2 Phone",
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
    phoneWs.close();

    const { frameKey } = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: b64uDecode(accept.machinePub),
      pairSecret: b64uDecode(qr.secret),
    });

    const ctrl = new WebSocket(relayUrl);
    await waitWsOpen(ctrl);
    ctrl.send(
      JSON.stringify({
        type: "hello",
        role: "phone",
        machineId: qr.mid,
        deviceId,
        token: accept.deviceToken,
      }),
    );
    await onceMessage(ctrl, (m) => m.type === "hello_ok");

    async function rpc(method: string, params: unknown = {}) {
      const id = `p2-${Math.random().toString(36).slice(2)}`;
      const sealed = sealFrame(
        frameKey,
        serializeControlPlain({ t: "req", id, method, params }),
      );
      expect(new TextDecoder().decode(sealed).includes(method)).toBe(false);
      ctrl.send(
        JSON.stringify({
          type: "send",
          channel: accept.channel,
          blob: b64uEncode(sealed),
        }),
      );
      // CX-2: skip interleaved t:"event" push frames until matching res.
      const resp = await onceMessage(ctrl, (m) => {
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
      expect(opened.t).toBe("res");
      if (opened.t === "res" && !opened.ok) throw new Error(opened.error);
      if (opened.t === "res" && opened.ok) return opened.result;
      throw new Error("bad res");
    }

    // --- Memory ---
    const beforeMem = (await rpc("memory.list")) as Array<{ id: string }>;
    expect(Array.isArray(beforeMem)).toBe(true);
    elog(`memory.list initial count=${beforeMem.length}`);

    const upserted = (await rpc("memory.upsert", {
      kind: "preference",
      title: "P2 remote note",
      content: "created over E2E control",
    })) as { id: string; title: string; kind: string };
    expect(upserted.id).toBeTruthy();
    expect(upserted.title).toBe("P2 remote note");
    elog(`memory.upsert id=${upserted.id}`);

    const listed = (await rpc("memory.list", {
      kind: "preference",
    })) as Array<{ id: string; title: string }>;
    expect(listed.some((m) => m.id === upserted.id)).toBe(true);
    elog(`memory.list preference count=${listed.length}`);

    const updated = (await rpc("memory.upsert", {
      id: upserted.id,
      kind: "preference",
      title: "P2 remote note v2",
      content: "updated over E2E",
    })) as { id: string; title: string };
    expect(updated.id).toBe(upserted.id);
    expect(updated.title).toContain("v2");

    await rpc("memory.delete", { id: upserted.id });
    const afterDel = (await rpc("memory.list", {
      kind: "preference",
    })) as Array<{ id: string }>;
    expect(afterDel.some((m) => m.id === upserted.id)).toBe(false);
    elog("memory delete reflected in list");

    // --- Schedule ---
    const tempRoot = (await rpc("workspace.ensureTemp", {
      label: "p2-sched",
    })) as string;
    expect(typeof tempRoot).toBe("string");
    expect(tempRoot.length).toBeGreaterThan(0);
    elog(`workspace.ensureTemp=${tempRoot}`);

    const beforeSched = (await rpc("schedule.list")) as Array<{ id: string }>;
    expect(Array.isArray(beforeSched)).toBe(true);

    const rule = (await rpc("schedule.create", {
      name: "P2 Morning Brief",
      goalTemplate: "Summarize overnight inbox for remote P2",
      cron: "0 9 * * 1-5",
      timezone: "UTC",
      approvalMode: "balanced",
      model: "grok-4.5",
      effort: "normal",
      workspaceRoots: [tempRoot],
      quietHoursRespect: true,
    })) as { id: string; name: string; enabled: boolean };
    expect(rule.id).toBeTruthy();
    expect(rule.name).toBe("P2 Morning Brief");
    expect(rule.enabled).toBe(true);
    elog(`schedule.create id=${rule.id}`);

    const schedList = (await rpc("schedule.list")) as Array<{
      id: string;
      name: string;
      enabled: boolean;
    }>;
    expect(schedList.some((r) => r.id === rule.id)).toBe(true);

    await rpc("schedule.setEnabled", { id: rule.id, enabled: false });
    const afterDisable = (await rpc("schedule.list")) as Array<{
      id: string;
      enabled: boolean;
    }>;
    const found = afterDisable.find((r) => r.id === rule.id);
    expect(found?.enabled).toBe(false);
    elog("schedule.setEnabled false reflected");

    await rpc("schedule.setEnabled", { id: rule.id, enabled: true });
    const afterEnable = (await rpc("schedule.list")) as Array<{
      id: string;
      enabled: boolean;
    }>;
    expect(afterEnable.find((r) => r.id === rule.id)?.enabled).toBe(true);
    elog("schedule.setEnabled true reflected");

    // Deny still works for non-allowlisted
    await expect(rpc("settings.set", { key: "x", value: 1 })).rejects.toThrow(
      /not allowed|Device revoked|unknown|Invalid/i,
    );
    elog("settings.set denied");

    // P3 multi-display list (NullHostBridge → empty array, still allowlisted path)
    const displays = (await rpc("remote.telepresence.listDisplays")) as unknown[];
    expect(Array.isArray(displays)).toBe(true);
    elog(`listDisplays count=${displays.length}`);

    elog("P2 E2E PASS schedule + memory over shipped RemoteSessionHost");
    ctrl.close();
  }, 90_000);
});
