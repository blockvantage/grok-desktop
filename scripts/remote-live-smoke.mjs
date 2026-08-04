/**
 * Live smoke against a running relay.
 * Spins an isolated Gateway + phone client: pair → tasks.create → tasks.list.
 *
 * Usage:
 *   node scripts/remote-live-smoke.mjs [--help] [--relay <url>] [--deadline-ms N]
 *                                      [--json] [--machine-id <id>] [--device-id <id>]
 *
 * Env:
 *   RELAY_WS   default relay WebSocket base (default ws://127.0.0.1:8788/v1)
 *
 * Responses are correlated by control-frame request id (never "next channel frame").
 * Events are routed independently and never treated as RPC results.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(
  path.join(root, "services/remote-relay/package.json"),
);
const WebSocket = require("ws");

const crypto = await import(
  path.join(root, "packages/shared/dist/remote-crypto.js")
);
const protocol = await import(
  path.join(root, "packages/shared/dist/remote-protocol.js")
);
const {
  b64uDecode,
  b64uEncode,
  decodePairingQr,
  deriveControlKeys,
  derivePairFrameKey,
  generateX25519KeyPair,
  openFrame,
  sealFrame,
} = crypto;
const {
  parseControlPlain: parseCP,
  serializeControlPlain: serializeCP,
  parseJsonBytes,
  serializeJson,
  PairAcceptPlainSchema,
} = protocol;

function printHelp() {
  console.log(`remote-live-smoke — pair + tasks.create through a relay

Options:
  --help                 Show this help
  --relay <url>          Relay WS URL (default: $RELAY_WS or ws://127.0.0.1:8788/v1)
  --deadline-ms <n>      Overall deadline in ms (default: 60000)
  --json                 Machine-readable JSON lines only (default on; kept for CLI parity)
  --machine-id <id>      Desk machine id (default: unique per run)
  --device-id <id>       Phone device id (default: unique per run)

Environment:
  RELAY_WS               Same as --relay when flag omitted

Exit codes:
  0  PASS
  1  FAIL
  2  usage / timeout
`);
}

function parseArgs(argv) {
  const out = {
    help: false,
    relay: process.env.RELAY_WS || "ws://127.0.0.1:8788/v1",
    deadlineMs: 60_000,
    machineId: `live-smoke-machine-${randomUUID().slice(0, 8)}`,
    deviceId: `live-phone-${randomUUID().slice(0, 8)}`,
    json: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--relay") out.relay = String(argv[++i] || "");
    else if (a === "--deadline-ms") out.deadlineMs = Number(argv[++i]);
    else if (a === "--machine-id") out.machineId = String(argv[++i] || "");
    else if (a === "--device-id") out.deviceId = String(argv[++i] || "");
    else if (a === "--json") out.json = true;
    else if (a === "--no-json") out.json = false;
    else {
      console.error(`Unknown argument: ${a}`);
      out.help = true;
    }
  }
  if (!Number.isFinite(out.deadlineMs) || out.deadlineMs < 1000) {
    out.deadlineMs = 60_000;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitOpen(ws, ms = 10000) {
  if (ws.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws open timeout")), ms);
    ws.once("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function onceMessage(ws, pred, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error("message timeout"));
    }, ms);
    function onMsg(data) {
      try {
        const msg = JSON.parse(String(data));
        if (pred(msg)) {
          clearTimeout(t);
          ws.off("message", onMsg);
          resolve(msg);
        }
      } catch {
        /* ignore */
      }
    }
    ws.on("message", onMsg);
  });
}

/**
 * Multiplexed control-channel reader: match RPC responses by id;
 * never treat events as results.
 */
function createControlChannel(ws, frameKey, channel, onEvent) {
  /** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
  const pending = new Map();

  function onMsg(data) {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type !== "recv" || String(msg.channel) !== channel) return;
    let plain;
    try {
      plain = parseCP(openFrame(frameKey, b64uDecode(String(msg.blob))));
    } catch {
      return;
    }
    if (plain.t === "event") {
      try {
        onEvent?.(plain);
      } catch {
        /* ignore */
      }
      return;
    }
    if (plain.t !== "res" || !plain.id) return;
    const waiter = pending.get(plain.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(plain.id);
    if (!plain.ok) {
      waiter.reject(new Error(String(plain.error ?? "rpc failed")));
      return;
    }
    waiter.resolve(plain.result);
  }

  ws.on("message", onMsg);

  return {
    rpc(method, params = {}, ms = 15000) {
      const id = "r-" + randomUUID().slice(0, 12);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`rpc timeout method=${method} id=${id}`));
        }, ms);
        pending.set(id, { resolve, reject, timer });
        try {
          ws.send(
            JSON.stringify({
              type: "send",
              channel,
              blob: b64uEncode(
                sealFrame(
                  frameKey,
                  serializeCP({ t: "req", id, method, params }),
                ),
              ),
            }),
          );
        } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    dispose() {
      ws.off("message", onMsg);
      for (const [id, w] of pending) {
        clearTimeout(w.timer);
        w.reject(new Error(`channel disposed pending id=${id}`));
      }
      pending.clear();
    },
  };
}

function log(step, extra = {}) {
  console.log(JSON.stringify({ step, ts: new Date().toISOString(), ...extra }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let RELAY_RAW = String(args.relay || "").replace(/\/$/, "");
  const RELAY = RELAY_RAW.includes("/v1") ? RELAY_RAW : RELAY_RAW + "/v1";
  const health =
    RELAY.replace(/^ws/i, "http").replace(/\/v1$/i, "") + "/health";

  const deadlineAt = Date.now() + args.deadlineMs;
  const remaining = () => Math.max(500, deadlineAt - Date.now());

  /** @type {import('../packages/gateway/dist/index.js').Gateway | null} */
  let gw = null;
  let dataDir = null;
  /** @type {import('ws') | null} */
  let phoneWs = null;
  /** @type {import('ws') | null} */
  let ctrl = null;
  /** @type {ReturnType<typeof createControlChannel> | null} */
  let channel = null;
  const events = [];

  const { Gateway } = await import(
    path.join(root, "packages/gateway/dist/index.js")
  );
  const { TestEngine } = await import(
    path.join(root, "packages/engine-testkit/dist/index.js")
  ).catch(async () => {
    return {
      TestEngine: class {
        async run() {
          return { status: "done" };
        }
      },
    };
  });

  try {
    if (Date.now() > deadlineAt) throw new Error("deadline before start");

    const h = await fetch(health).then((r) => r.json());
    log("relay_health", h);
    if (!h?.ok) {
      throw new Error(
        "relay unhealthy — start PORT=8788 HOST=0.0.0.0 relay or pass --relay",
      );
    }

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-live-"));
    gw = new Gateway(
      {
        dataDir,
        dbPath: path.join(dataDir, "db.sqlite"),
        logsDir: path.join(dataDir, "logs"),
      },
      { engine: new TestEngine(), machineId: args.machineId },
    );
    await gw.start();

    const relayBase = RELAY.replace(/\/v1$/i, "");
    await gw.handle({
      id: "en",
      method: "remote.enable",
      params: { relayUrl: relayBase },
    });
    for (let i = 0; i < 50; i++) {
      if (gw.remoteSession?.isRelayReady()) break;
      await sleep(100);
      if (Date.now() > deadlineAt) throw new Error("deadline waiting desk relay");
    }
    if (!gw.remoteSession?.isRelayReady()) {
      throw new Error("RemoteSessionHost not ready on relay");
    }
    log("desk_ready", { machineId: args.machineId });

    const pairing = await gw.handle({
      id: "pair",
      method: "remote.pairing.start",
      params: { ttlMs: 120_000 },
    });
    const qr = decodePairingQr(pairing.qrString);
    log("qr", { mid: qr.mid, relay: qr.relay });

    const phone = generateX25519KeyPair();
    const deviceId = args.deviceId;
    phoneWs = new WebSocket(RELAY);
    await waitOpen(phoneWs, remaining());
    phoneWs.send(
      JSON.stringify({
        type: "hello",
        role: "phone",
        machineId: qr.mid,
        deviceId,
        token: "pair-temp-" + deviceId,
      }),
    );
    await onceMessage(phoneWs, (m) => m.type === "hello_ok", remaining());

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
              deviceLabel: "LiveSmoke",
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
      remaining(),
    );
    const accept = PairAcceptPlainSchema.parse(
      parseJsonBytes(openFrame(pairKey, b64uDecode(String(acceptMsg.blob)))),
    );
    log("paired", { channel: accept.channel, deviceId: accept.deviceId });
    phoneWs.close();
    phoneWs = null;

    ctrl = new WebSocket(RELAY);
    await waitOpen(ctrl, remaining());
    ctrl.send(
      JSON.stringify({
        type: "hello",
        role: "phone",
        machineId: accept.machineId,
        deviceId: accept.deviceId,
        token: accept.deviceToken,
      }),
    );
    await onceMessage(ctrl, (m) => m.type === "hello_ok", remaining());

    const { frameKey } = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: b64uDecode(accept.machinePub),
      pairSecret: b64uDecode(qr.secret),
    });

    channel = createControlChannel(
      ctrl,
      frameKey,
      accept.channel,
      (ev) => {
        events.push({
          channel: ev.channel,
          at: new Date().toISOString(),
        });
        log("event", { channel: ev.channel });
      },
    );

    const rpcMs = Math.min(15_000, remaining());
    const before = await channel.rpc("tasks.list", {}, rpcMs);
    log("list_before", { n: Array.isArray(before) ? before.length : -1 });

    const created = await channel.rpc(
      "tasks.create",
      {
        goal: `live-smoke ${new Date().toISOString()}`,
        mode: "interactive",
        model: "grok-4.5",
        effort: "normal",
        workspaceRoots: [],
        approvalMode: "balanced",
        skills: [],
        mcpServerIds: [],
        attachments: [],
        clientMutationId: `smoke-${randomUUID()}`,
      },
      Math.min(15_000, remaining()),
    );
    log("created", { id: created?.id, status: created?.status });
    if (!created?.id) throw new Error("tasks.create returned no id");

    const after = await channel.rpc(
      "tasks.list",
      {},
      Math.min(15_000, remaining()),
    );
    const found = (after || []).some((t) => t.id === created.id);
    log("list_after", {
      n: after?.length,
      found,
      eventsSeen: events.length,
    });
    if (!found) throw new Error("created task missing from list");

    log("PASS", {
      taskId: created.id,
      machineId: args.machineId,
      deviceId: args.deviceId,
      eventsSeen: events.length,
    });
  } finally {
    try {
      channel?.dispose();
    } catch {
      /* ignore */
    }
    try {
      ctrl?.close();
    } catch {
      /* ignore */
    }
    try {
      phoneWs?.close();
    } catch {
      /* ignore */
    }
    try {
      await gw?.stop?.();
    } catch {
      /* ignore */
    }
    if (dataDir) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((e) => {
  log("FAIL", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
