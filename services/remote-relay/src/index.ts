/**
 * Blind remote relay: health HTTP + WebSocket frame router.
 * Never logs blob contents — only length/routing metadata.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { RelayStore } from "./store.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

/** CORS so Electron renderer (Vite :5173 / file://) can probe /health. */
function applyCors(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const origin = req.headers.origin;
  // Reflect request origin when present (credentials-safe for local dev);
  // otherwise allow any origin for simple health checks.
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (origin) res.setHeader("Vary", "Origin");
}

export function createRelayServer(opts?: { port?: number; host?: string }) {
  const store = new RelayStore();
  const port = opts?.port ?? PORT;
  const host = opts?.host ?? HOST;

  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      applyCors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === "/health" || req.url === "/healthz") {
      applyCors(req, res);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...store.stats() }));
      return;
    }
    applyCors(req, res);
    res.writeHead(404);
    res.end("not found");
  });

  // Cap HTTP keep-alives / concurrent sockets for health probes and upgrades.
  server.maxConnections = 4_096;

  // Cap frames before JSON.parse (~512 KiB) so a single client cannot OOM the relay.
  const wss = new WebSocketServer({
    server,
    path: "/v1",
    maxPayload: 512 * 1024,
  });

  wss.on("connection", (ws: WebSocket) => {
    const peerId = randomUUID();
    let helloDone = false;

    const send = (obj: unknown) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    };

    send({ type: "welcome", connectionId: peerId });

    ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        send({ type: "err", code: "bad_json", message: "invalid json" });
        return;
      }
      const type = msg.type;
      if (type === "ping") {
        send({ type: "pong" });
        return;
      }
      if (type === "hello") {
        const role = msg.role as "desk" | "phone";
        const machineId = String(msg.machineId ?? "");
        const token = String(msg.token ?? "");
        const deviceId =
          typeof msg.deviceId === "string" ? msg.deviceId : undefined;
        if (
          !machineId ||
          machineId.length > 128 ||
          !token ||
          token.length > 512 ||
          (deviceId != null && deviceId.length > 128) ||
          (role !== "desk" && role !== "phone")
        ) {
          send({ type: "err", code: "bad_hello", message: "invalid hello" });
          return;
        }
        const result = store.register({
          id: peerId,
          role,
          machineId,
          deviceId,
          token,
          push: send,
        });
        if (!result.ok) {
          send({ type: "err", code: result.code, message: result.message });
          return;
        }
        helloDone = true;
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            event: "hello",
            peerId,
            role,
            machineId,
            deviceId: deviceId ?? null,
          }),
        );
        send({ type: "hello_ok", role, machineId, deviceId: deviceId ?? null });
        return;
      }
      if (type === "send") {
        if (!helloDone) {
          send({ type: "err", code: "not_hello", message: "hello required" });
          return;
        }
        const channel = String(msg.channel ?? "");
        if (!channel || channel.length > 256) {
          send({ type: "err", code: "bad_channel", message: "invalid channel" });
          return;
        }
        const blob = String(msg.blob ?? "");
        const result = store.send(peerId, channel, blob);
        if (!result.ok) {
          send({ type: "err", code: result.code, message: result.message });
          return;
        }
        // Log routing only — never blob
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            event: "send",
            peerId,
            channel,
            blobBytes: blob.length,
            delivered: result.delivered,
          }),
        );
        return;
      }
      send({ type: "err", code: "unknown_type", message: `unknown type ${String(type)}` });
    });

    ws.on("close", () => {
      store.unregister(peerId);
    });
  });

  return {
    server,
    store,
    start(): Promise<{ port: number; host: string }> {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const addr = server.address();
          const p =
            typeof addr === "object" && addr ? addr.port : port;
          resolve({ port: p, host });
        });
      });
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

// CLI entry
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") ||
    process.argv[1].endsWith("index.js") ||
    process.argv[1].includes("remote-relay"));

if (isMain) {
  const relay = createRelayServer();
  const { port, host } = await relay.start();
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "listening",
      health: `http://127.0.0.1:${port}/health`,
      ws: `ws://127.0.0.1:${port}/v1`,
      host,
      port,
    }),
  );
}
