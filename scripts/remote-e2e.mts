/**
 * End-to-end: real relay + real Gateway + scripted phone peer.
 * Proves pair → tasks.list → pauseAll → revoke over E2E-encrypted frames.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  sealFrame,
  serializeControlPlain,
  serializeJson,
  parseJsonBytes,
  PairOfferPlainSchema,
  PairAcceptPlainSchema,
  type ControlPlain,
} from "@grokdesk/shared";
import { Gateway } from "@grokdesk/gateway";
import { TestEngine } from "@grokdesk/engine-testkit";
import { createRelayServer } from "../services/remote-relay/src/index.ts";

const SCRATCH =
  process.env.GROK_SCRATCH || path.join(os.tmpdir(), "grok-remote-e2e");

function log(line: string) {
  const p = path.join(SCRATCH, "remote-e2e.log");
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.appendFileSync(p, line + "\n");
  console.log(line);
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
  ms = 15_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("timeout waiting message")),
      ms,
    );
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

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, "remote-e2e.log"), "");

  const relay = createRelayServer({ port: 0, host: "127.0.0.1" });
  const { port } = await relay.start();
  const relayUrl = `ws://127.0.0.1:${port}/v1`;
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const health = await fetch(healthUrl).then((r) => r.json());
  log(`health: ${JSON.stringify(health)}`);
  fs.writeFileSync(
    path.join(SCRATCH, "relay-health.json"),
    JSON.stringify(health, null, 2),
  );

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-e2e-"));
  const gw = new Gateway(
    {
      dataDir,
      dbPath: path.join(dataDir, "db.sqlite"),
      logsDir: path.join(dataDir, "logs"),
    },
    { engine: new TestEngine(), machineId: "e2e-machine" },
  );
  await gw.start();

  gw.remote.enable(relayUrl);
  const pairing = gw.remote.startPairing({ ttlMs: 120_000 });
  log(`qr: ${pairing.qrString.slice(0, 100)}…`);
  fs.writeFileSync(path.join(SCRATCH, "qr-sample.txt"), pairing.qrString);
  const qr = decodePairingQr(pairing.qrString);

  const deskWs = new WebSocket(relayUrl);
  await waitWsOpen(deskWs);
  deskWs.send(
    JSON.stringify({
      type: "hello",
      role: "desk",
      machineId: "e2e-machine",
      token: gw.remote.getDeskToken(),
    }),
  );
  await onceMessage(deskWs, (m) => m.type === "hello_ok");

  const machineKp = gw.remote.getMachineKeyPair();
  const deviceSessions = new Map<string, { frameKey: Uint8Array }>();

  deskWs.on("message", async (data) => {
    const msg = JSON.parse(String(data)) as Record<string, unknown>;
    if (msg.type !== "recv") return;
    const channel = String(msg.channel);
    const blobB64 = String(msg.blob);
    const blob = b64uDecode(blobB64);
    log(`desk recv channel=${channel} blobBytes=${blobB64.length}`);

    if (channel.startsWith("pair:")) {
      const offerRaw = gw.remote.tryOpenPairBlob(
        blob,
        openFrame,
        derivePairFrameKey,
      );
      if (!offerRaw) {
        log("desk: could not open pair blob");
        return;
      }
      const offer = PairOfferPlainSchema.parse(parseJsonBytes(offerRaw));
      const accept = gw.remote.acceptPairOffer(offer);
      const phonePub = b64uDecode(offer.devicePub);
      const { frameKey } = deriveControlKeys({
        mySecret: machineKp.secretKey,
        theirPublic: phonePub,
        pairSecret: b64uDecode(offer.pairSecret),
      });
      deviceSessions.set(offer.deviceId, { frameKey });
      const sealedAccept = sealFrame(
        derivePairFrameKey(b64uDecode(offer.pairSecret)),
        serializeJson(accept),
      );
      deskWs.send(
        JSON.stringify({
          type: "send",
          channel,
          blob: b64uEncode(sealedAccept),
        }),
      );
      log(`paired device ${offer.deviceId}`);
      return;
    }

    if (channel.startsWith("ctrl:")) {
      const deviceId = channel.split(":")[2]!;
      const sess = deviceSessions.get(deviceId);
      if (!sess) return;
      const plain = parseControlPlain(openFrame(sess.frameKey, blob));
      if (plain.t !== "req") return;
      try {
        gw.remote.assertMethodAllowed(plain.method);
        const result = await gw.handle({
          id: plain.id,
          method: plain.method,
          params: (plain.params ?? {}) as never,
        } as never);
        const res: ControlPlain = {
          t: "res",
          id: plain.id,
          ok: true,
          result,
        };
        deskWs.send(
          JSON.stringify({
            type: "send",
            channel,
            blob: b64uEncode(
              sealFrame(sess.frameKey, serializeControlPlain(res)),
            ),
          }),
        );
      } catch (e) {
        const res: ControlPlain = {
          t: "res",
          id: plain.id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
        deskWs.send(
          JSON.stringify({
            type: "send",
            channel,
            blob: b64uEncode(
              sealFrame(sess.frameKey, serializeControlPlain(res)),
            ),
          }),
        );
      }
    }
  });

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
      token: "pairing-temp-token-" + deviceId,
    }),
  );
  await onceMessage(phoneWs, (m) => m.type === "hello_ok");

  const pairKey = derivePairFrameKey(b64uDecode(qr.secret));
  const offer = {
    v: 1 as const,
    kind: "pair_offer" as const,
    deviceId,
    deviceLabel: "E2E Phone",
    devicePub: b64uEncode(phone.publicKey),
    pairSecret: qr.secret,
  };
  phoneWs.send(
    JSON.stringify({
      type: "send",
      channel: `pair:${qr.mid}`,
      blob: b64uEncode(sealFrame(pairKey, serializeJson(offer))),
    }),
  );

  const acceptMsg = await onceMessage(
    phoneWs,
    (m) => m.type === "recv" && String(m.channel).startsWith("pair:"),
  );
  // Ciphertext must not contain device label
  if (String(acceptMsg.blob).includes("E2E Phone")) {
    throw new Error("pair blob not encrypted");
  }
  const acceptPlain = PairAcceptPlainSchema.parse(
    parseJsonBytes(openFrame(pairKey, b64uDecode(String(acceptMsg.blob)))),
  );
  log(`accept channel=${acceptPlain.channel}`);

  const { frameKey } = deriveControlKeys({
    mySecret: phone.secretKey,
    theirPublic: b64uDecode(acceptPlain.machinePub),
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
      token: acceptPlain.deviceToken,
    }),
  );
  await onceMessage(phoneWs2, (m) => m.type === "hello_ok");

  async function rpc(method: string, params: unknown = {}): Promise<unknown> {
    const id = `r-${Math.random().toString(36).slice(2)}`;
    const plain: ControlPlain = { t: "req", id, method, params };
    const sealed = sealFrame(frameKey, serializeControlPlain(plain));
    if (new TextDecoder().decode(sealed).includes(method)) {
      throw new Error("ciphertext leaked method name");
    }
    phoneWs2.send(
      JSON.stringify({
        type: "send",
        channel: acceptPlain.channel,
        blob: b64uEncode(sealed),
      }),
    );
    const resp = await onceMessage(
      phoneWs2,
      (m) => m.type === "recv" && String(m.channel) === acceptPlain.channel,
    );
    const opened = parseControlPlain(
      openFrame(frameKey, b64uDecode(String(resp.blob))),
    );
    if (opened.t !== "res") throw new Error("expected res");
    if (!opened.ok) throw new Error(opened.error);
    return opened.result;
  }

  await gw.handle({
    id: "seed",
    method: "tasks.create",
    params: {
      goal: "E2E seeded task",
      mode: "interactive",
      model: "grok-4.5",
      effort: "fast",
      workspaceRoots: [],
      approvalMode: "balanced",
      skills: [],
      mcpServerIds: [],
      attachments: [],
    },
  } as never);

  const list = (await rpc("tasks.list")) as unknown[];
  log(`tasks.list count=${Array.isArray(list) ? list.length : -1}`);
  if (!Array.isArray(list) || list.length < 1) {
    throw new Error("tasks.list expected at least 1 task");
  }

  await rpc("tasks.pauseAll");
  log("tasks.pauseAll ok");

  let denied = false;
  try {
    await rpc("auth.signIn");
  } catch {
    denied = true;
  }
  if (!denied) throw new Error("auth.signIn should be denied");
  log("auth.signIn denied ok");

  const devices = gw.remote.listDevices();
  log(`devices before revoke: ${devices.length}`);
  gw.remote.revokeDevice(deviceId);
  if (gw.remote.isDeviceActive(deviceId)) throw new Error("revoke failed");
  log("revoke ok");

  await gw.stop();
  deskWs.close();
  phoneWs2.close();
  await relay.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
  log("E2E PASS");
}

main().catch((e) => {
  console.error(e);
  try {
    log(`E2E FAIL: ${e instanceof Error ? e.message : String(e)}`);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
