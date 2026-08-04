/**
 * Gating e2e: real relay + real Gateway + **shipped** RemoteSessionHost + scripted phone.
 * Exercises coworker control surface and post-revoke denial.
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
} from "@grokdesk/shared";
import { TestEngine } from "@grokdesk/engine-testkit";
import { Gateway } from "./index.js";
import { createRelayServer } from "../../../services/remote-relay/src/index.js";

const SCRATCH =
  process.env.GROK_SCRATCH ||
  path.join(os.tmpdir(), "grok-remote-e2e");

function elog(line: string) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.appendFileSync(path.join(SCRATCH, "remote-e2e.log"), line + "\n");
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

describe("remote e2e via shipped RemoteSessionHost", () => {
  let relay: ReturnType<typeof createRelayServer>;
  let port: number;
  let dataDir: string;
  let gw: Gateway;

  beforeAll(async () => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(path.join(SCRATCH, "remote-e2e.log"), "");
    relay = createRelayServer({ port: 0, host: "127.0.0.1" });
    ({ port } = await relay.start());
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-e2e-"));
    gw = new Gateway(
      {
        dataDir,
        dbPath: path.join(dataDir, "db.sqlite"),
        logsDir: path.join(dataDir, "logs"),
      },
      { engine: new TestEngine(), machineId: "e2e-machine" },
    );
    await gw.start();
  }, 60_000);

  afterAll(async () => {
    await gw?.stop().catch(() => {});
    await relay?.stop().catch(() => {});
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("pairs, full coworker control, revoke blocks further RPCs", async () => {
    const relayUrl = `ws://127.0.0.1:${port}/v1`;
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) =>
      r.json(),
    );
    elog(`health: ${JSON.stringify(health)}`);
    fs.writeFileSync(
      path.join(SCRATCH, "relay-health.json"),
      JSON.stringify(health, null, 2),
    );
    expect((health as { ok: boolean }).ok).toBe(true);

    expect(gw.remoteSession).toBeTruthy();
    await gw.handle({
      id: "en",
      method: "remote.enable",
      params: { relayUrl },
    } as never);
    for (let i = 0; i < 50; i++) {
      if (gw.remoteSession?.isRelayReady()) break;
      await sleep(100);
    }
    expect(gw.remote.status().enabled).toBe(true);
    expect(gw.remoteSession?.isRelayReady()).toBe(true);
    elog("RemoteSessionHost relay ready");

    const pairing = await gw.handle({
      id: "pair",
      method: "remote.pairing.start",
      params: { ttlMs: 120_000 },
    } as never) as { qrString: string };
    fs.writeFileSync(path.join(SCRATCH, "qr-sample.txt"), pairing.qrString);
    elog(`qr: ${pairing.qrString.slice(0, 80)}…`);
    const qr = decodePairingQr(pairing.qrString);

    const phone = generateX25519KeyPair();
    const deviceId = "phone-e2e-1";
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
    const offerBlob = sealFrame(
      pairKey,
      serializeJson({
        v: 1,
        kind: "pair_offer",
        deviceId,
        deviceLabel: "E2E Phone",
        devicePub: b64uEncode(phone.publicKey),
        pairSecret: qr.secret,
      }),
    );
    expect(b64uEncode(offerBlob).includes("E2E Phone")).toBe(false);
    phoneWs.send(
      JSON.stringify({
        type: "send",
        channel: `pair:${qr.mid}`,
        blob: b64uEncode(offerBlob),
      }),
    );

    const acceptMsg = await onceMessage(
      phoneWs,
      (m) => m.type === "recv" && String(m.channel).startsWith("pair:"),
    );
    expect(String(acceptMsg.blob).includes("E2E Phone")).toBe(false);
    const accept = PairAcceptPlainSchema.parse(
      parseJsonBytes(openFrame(pairKey, b64uDecode(String(acceptMsg.blob)))),
    );
    elog(`accept via RemoteSessionHost channel=${accept.channel}`);
    expect(gw.remote.isDeviceActive(deviceId)).toBe(true);

    const { frameKey } = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: b64uDecode(accept.machinePub),
      pairSecret: b64uDecode(qr.secret),
    });

    // Prove openFrame recovers sealed control plaintext with peer key
    const samplePlain = serializeControlPlain({
      t: "req",
      id: "proof",
      method: "tasks.list",
      params: { goal: "SECRET_GOAL_PROOF" },
    });
    const sampleSealed = sealFrame(frameKey, samplePlain);
    expect(new TextDecoder().decode(sampleSealed).includes("SECRET_GOAL_PROOF")).toBe(
      false,
    );
    expect(new TextDecoder().decode(sampleSealed).includes("tasks.list")).toBe(false);
    const recovered = parseControlPlain(openFrame(frameKey, sampleSealed));
    expect(recovered).toMatchObject({
      t: "req",
      method: "tasks.list",
      params: { goal: "SECRET_GOAL_PROOF" },
    });
    elog("ciphertext proof: sealed lacks plaintext; openFrame recovers");

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
      const sealed = sealFrame(
        frameKey,
        serializeControlPlain({ t: "req", id, method, params }),
      );
      expect(new TextDecoder().decode(sealed).includes(method)).toBe(false);
      phoneWs2.send(
        JSON.stringify({
          type: "send",
          channel: accept.channel,
          blob: b64uEncode(sealed),
        }),
      );
      // CX-2: control channel may carry t:"event" push frames — wait for matching res.
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
      expect(opened.t).toBe("res");
      if (opened.t === "res" && !opened.ok) throw new Error(opened.error);
      if (opened.t === "res" && opened.ok) return opened.result;
      throw new Error("bad res");
    }

    // Create task **over remote** (not only desk seed)
    const created = (await rpc("tasks.create", {
      goal: "Remote-created coworker task",
      mode: "interactive",
      model: "grok-4.5",
      effort: "fast",
      workspaceRoots: [],
      approvalMode: "balanced",
      skills: [],
      mcpServerIds: [],
      attachments: [],
    })) as { id: string; goal: string };
    expect(created.id).toBeTruthy();
    expect(created.goal).toContain("Remote-created");
    elog(`tasks.create id=${created.id}`);

    const list = (await rpc("tasks.list")) as Array<{ id: string; goal: string }>;
    expect(list.some((t) => t.id === created.id)).toBe(true);
    elog(`tasks.list count=${list.length}`);

    const events = (await rpc("events.list", {
      taskId: created.id,
      afterSeq: 0,
    })) as unknown[];
    expect(Array.isArray(events)).toBe(true);
    elog(`events.list count=${events.length}`);

    // Inbox via real gateway state
    const inboxItem = gw.inbox.add({
      kind: "needs_you",
      title: "Needs you e2e",
      body: "Please check remote task",
      taskId: created.id,
    });
    const inbox = (await rpc("inbox.list")) as Array<{ id: string; title: string }>;
    expect(inbox.some((i) => i.id === inboxItem.id)).toBe(true);
    await rpc("inbox.markRead", { id: inboxItem.id });
    await rpc("inbox.dismiss", { id: inboxItem.id });
    const inboxAfter = (await rpc("inbox.list")) as Array<{ id: string }>;
    expect(inboxAfter.some((i) => i.id === inboxItem.id)).toBe(false);
    elog("inbox list/markRead/dismiss ok");

    // Approve path: inject waiting approval via task event if runner supports it
    // Prefer exercising tasks.approve with a synthetic pending approval when present.
    const taskRow = list.find((t) => t.id === created.id);
    if (taskRow) {
      try {
        // If no approval pending, approve with fake id should error — still exercises proxy
        await rpc("tasks.approve", {
          taskId: created.id,
          approvalId: "nonexistent-approval",
          decision: "approve",
        });
      } catch (e) {
        elog(
          `tasks.approve exercised (expected fail without pending): ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    await rpc("tasks.pauseAll");
    elog("pauseAll ok via RemoteSessionHost");

    await expect(rpc("auth.signIn")).rejects.toThrow(/not allowed|Device revoked/i);
    elog("auth.signIn denied");

    // Revoke via production IPC
    await gw.handle({
      id: "rev",
      method: "remote.devices.revoke",
      params: { deviceId },
    } as never);
    expect(gw.remote.isDeviceActive(deviceId)).toBe(false);
    elog("revoke ok");

    // Post-revoke: control RPC must fail clearly (Device revoked)
    await expect(rpc("tasks.list")).rejects.toThrow(/revoked/i);
    elog("post-revoke tasks.list denied");

    elog("E2E PASS (shipped RemoteSessionHost, full coworker + revoke)");
    phoneWs2.close();
  }, 90_000);
});
