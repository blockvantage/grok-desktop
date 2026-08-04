/**
 * CX-1 / CX-7 / CX-10: timeout fatality, relay err isolation, queue flush-after-enqueue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  b64uDecode,
  b64uEncode,
  deriveControlKeys,
  generateX25519KeyPair,
  openFrame,
  parseControlPlain,
  sealFrame,
  serializeControlPlain,
} from "@grokdesk/shared/remote";
import { RemoteGatewayClient, type WsLike } from "./remote-client";
import type { StoredSession } from "../storage/session";
import {
  clearOfflineQueue,
  loadOfflineQueue,
} from "../storage/offline-queue";

function sessionFixture(pairFill = 4): {
  session: StoredSession;
  desk: ReturnType<typeof generateX25519KeyPair>;
  phone: ReturnType<typeof generateX25519KeyPair>;
  pairSecret: Uint8Array;
} {
  const desk = generateX25519KeyPair();
  const phone = generateX25519KeyPair();
  const pairSecret = new Uint8Array(32).fill(pairFill);
  return {
    desk,
    phone,
    pairSecret,
    session: {
      machineId: "m-to",
      machinePub: b64uEncode(desk.publicKey),
      deviceId: "d-to",
      deviceToken: "tok",
      channel: "ctrl:m-to:d-to",
      relay: "ws://test/v1",
      pairSecret: b64uEncode(pairSecret),
      deviceSecretB64: b64uEncode(phone.secretKey),
      devicePubB64: b64uEncode(phone.publicKey),
      deviceLabel: "t",
    },
  };
}

type Handler = (ev: { data: unknown }) => void;

function makeLiveWs(opts: {
  session: StoredSession;
  desk: ReturnType<typeof generateX25519KeyPair>;
  phone: ReturnType<typeof generateX25519KeyPair>;
  pairSecret: Uint8Array;
  /** Methods that should never get a response (timeout). */
  timeoutMethods?: Set<string>;
  /** Methods that succeed. */
  okMethods?: Set<string>;
}): { ws: WsLike; push: (data: string) => void } {
  const msgHandlers: Handler[] = [];
  const push = (data: string) => {
    for (const h of msgHandlers) h({ data });
  };
  const timeoutMethods = opts.timeoutMethods ?? new Set<string>();
  const okMethods = opts.okMethods ?? new Set(["tasks.list"]);

  const ws: WsLike = {
    readyState: 1,
    send: (raw: string) => {
      const msg = JSON.parse(raw) as Record<string, unknown>;
      if (msg.type === "hello") {
        queueMicrotask(() => push(JSON.stringify({ type: "hello_ok" })));
        return;
      }
      if (msg.type === "send" && typeof msg.blob === "string") {
        queueMicrotask(() => {
          const { frameKey } = deriveControlKeys({
            mySecret: opts.desk.secretKey,
            theirPublic: opts.phone.publicKey,
            pairSecret: opts.pairSecret,
          });
          const plain = parseControlPlain(
            openFrame(frameKey, b64uDecode(msg.blob as string)),
          );
          if (plain.t !== "req") return;
          if (timeoutMethods.has(plain.method)) return;
          if (
            okMethods.size > 0 &&
            !okMethods.has(plain.method) &&
            !timeoutMethods.has(plain.method)
          ) {
            // unlisted → still ok (default)
          }
          const res = sealFrame(
            frameKey,
            serializeControlPlain({
              t: "res",
              id: plain.id,
              ok: true,
              result:
                plain.method === "tasks.list"
                  ? []
                  : plain.method === "memory.delete"
                    ? { ok: true }
                    : { ok: true },
            }),
          );
          push(
            JSON.stringify({
              type: "recv",
              channel: opts.session.channel,
              blob: b64uEncode(res),
            }),
          );
        });
      }
    },
    close: () => {},
    addEventListener: (type, fn) => {
      if (type === "message") msgHandlers.push(fn as Handler);
      if (type === "open") queueMicrotask(() => (fn as () => void)());
    },
    removeEventListener: () => {},
  };
  return { ws, push };
}

const SHORT_RPC_MS = 80;

describe("CX-1 timeout fatality", () => {
  beforeEach(async () => {
    await clearOfflineQueue();
  });

  it("first desk-did-not-answer timeout is non-fatal", async () => {
    const { session, desk, phone, pairSecret } = sessionFixture(11);
    const { ws } = makeLiveWs({
      session,
      desk,
      phone,
      pairSecret,
      timeoutMethods: new Set(["tasks.list"]),
      okMethods: new Set(),
    });
    const client = new RemoteGatewayClient(
      session,
      async () => ws,
      200,
      SHORT_RPC_MS,
    );
    client.enableAutoReconnect(false);
    const fatal = vi.fn();
    client.onFatalSession(fatal);

    await expect(client.connect()).rejects.toThrow(
      /timeout|did not answer|unreachable/i,
    );
    expect(fatal).not.toHaveBeenCalled();
  });

  it("second consecutive timeout after fresh transport fires fatal once", async () => {
    const { session, desk, phone, pairSecret } = sessionFixture(12);
    let generation = 0;
    const createWs = vi.fn(async () => {
      generation += 1;
      // gen1: health ok, later RPCs time out
      // gen2: health times out → consecutive timeout #2 → fatal
      const timeoutMethods =
        generation === 1
          ? new Set(["memory.list"])
          : new Set(["tasks.list", "memory.list"]);
      const okMethods =
        generation === 1 ? new Set(["tasks.list"]) : new Set<string>();
      return makeLiveWs({
        session,
        desk,
        phone,
        pairSecret,
        timeoutMethods,
        okMethods,
      }).ws;
    });

    const client = new RemoteGatewayClient(
      session,
      createWs,
      200,
      SHORT_RPC_MS,
    );
    client.enableAutoReconnect(false);
    const fatal = vi.fn();
    client.onFatalSession(fatal);

    await client.connect();
    expect(client.isConnected).toBe(true);

    await expect(client.request("memory.list")).rejects.toThrow(
      /timeout|did not answer/i,
    );
    expect(fatal).not.toHaveBeenCalled();

    await expect(client.connect()).rejects.toThrow(
      /out of sync|revoked|re-pair/i,
    );
    expect(fatal).toHaveBeenCalledTimes(1);
  });
});

describe("CX-7 relay err isolation", () => {
  beforeEach(async () => {
    await clearOfflineQueue();
  });

  it("blob_too_large does not force connect_fail", async () => {
    const { session, desk, phone, pairSecret } = sessionFixture(13);
    const { ws, push } = makeLiveWs({
      session,
      desk,
      phone,
      pairSecret,
      okMethods: new Set(["tasks.list"]),
    });
    const client = new RemoteGatewayClient(session, async () => ws, 200);
    await client.connect();
    expect(client.connection.state).toBe("online");

    push(
      JSON.stringify({
        type: "err",
        code: "blob_too_large",
        message: "blob too large",
      }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(client.connection.state).toBe("online");
    const list = await client.request("tasks.list");
    expect(Array.isArray(list)).toBe(true);
  });

  it("desk_offline surfaces connect_fail", async () => {
    const { session, desk, phone, pairSecret } = sessionFixture(14);
    const { ws, push } = makeLiveWs({
      session,
      desk,
      phone,
      pairSecret,
      okMethods: new Set(["tasks.list"]),
    });
    const client = new RemoteGatewayClient(session, async () => ws, 200);
    await client.connect();

    push(
      JSON.stringify({
        type: "err",
        code: "desk_offline",
        message: "desk is not connected",
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(
      client.connection.lastError?.includes("desk") ||
        client.connection.state !== "online",
    ).toBe(true);
  });
});

describe("CX-10 flush after enqueue", () => {
  beforeEach(async () => {
    await clearOfflineQueue();
  });

  it("enqueued item flushes once the in-flight connect resolves", async () => {
    const { session, desk, phone, pairSecret } = sessionFixture(15);
    let resolveOpen: (() => void) | null = null;
    const openGate = new Promise<void>((r) => {
      resolveOpen = r;
    });

    type H = (ev: { data: unknown }) => void;
    const msgHandlers: H[] = [];
    let deleted = false;

    const ws: WsLike = {
      readyState: 0,
      send: (raw: string) => {
        const msg = JSON.parse(raw) as { type: string; blob?: string };
        if (msg.type === "hello") {
          queueMicrotask(() => {
            for (const h of msgHandlers) {
              h({ data: JSON.stringify({ type: "hello_ok" }) });
            }
          });
          return;
        }
        if (msg.type === "send" && msg.blob) {
          queueMicrotask(() => {
            const { frameKey } = deriveControlKeys({
              mySecret: desk.secretKey,
              theirPublic: phone.publicKey,
              pairSecret,
            });
            const plain = parseControlPlain(
              openFrame(frameKey, b64uDecode(msg.blob!)),
            );
            if (plain.t !== "req") return;
            if (plain.method === "memory.delete") deleted = true;
            const res = sealFrame(
              frameKey,
              serializeControlPlain({
                t: "res",
                id: plain.id,
                ok: true,
                result: plain.method === "tasks.list" ? [] : { ok: true },
              }),
            );
            for (const h of msgHandlers) {
              h({
                data: JSON.stringify({
                  type: "recv",
                  channel: session.channel,
                  blob: b64uEncode(res),
                }),
              });
            }
          });
        }
      },
      close: () => {},
      addEventListener: (type, fn) => {
        if (type === "message") msgHandlers.push(fn as H);
        if (type === "open") {
          void openGate.then(() => {
            (ws as { readyState: number }).readyState = 1;
            (fn as () => void)();
          });
        }
      },
      removeEventListener: () => {},
    };

    const client = new RemoteGatewayClient(session, async () => ws, 2000);
    const connectP = client.connect();
    const q = await client.requestOrQueue("memory.delete", { id: "m1" });
    expect(q.queued).toBe(true);
    expect((await loadOfflineQueue()).length).toBe(1);

    resolveOpen!();
    await connectP;
    await new Promise((r) => setTimeout(r, 50));
    expect(deleted).toBe(true);
    expect((await loadOfflineQueue()).length).toBe(0);
    await clearOfflineQueue();
  });
});
