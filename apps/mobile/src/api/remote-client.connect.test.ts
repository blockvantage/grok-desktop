/**
 * Tests for shipped RemoteGatewayClient connect quality:
 * - concurrent connect shares one in-flight Promise
 * - waitOpen times out so connecting cannot brick forever
 * - flush failures surface on connection model
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  b64uDecode,
  b64uEncode,
  createOfflineQueueItem,
  deriveControlKeys,
  generateX25519KeyPair,
  openFrame,
  parseControlPlain,
  sealFrame,
  serializeControlPlain,
} from "@grokdesk/shared/remote";
import {
  RemoteGatewayClient,
  waitOpen,
  type WsLike,
} from "./remote-client";
import type { StoredSession } from "../storage/session";
import {
  clearOfflineQueue,
  saveOfflineQueue,
} from "../storage/offline-queue";

function sessionFixture(
  overrides?: Partial<{ desk: ReturnType<typeof generateX25519KeyPair>; phone: ReturnType<typeof generateX25519KeyPair>; pairSecret: Uint8Array }>,
): {
  session: StoredSession;
  desk: ReturnType<typeof generateX25519KeyPair>;
  phone: ReturnType<typeof generateX25519KeyPair>;
  pairSecret: Uint8Array;
} {
  const desk = overrides?.desk ?? generateX25519KeyPair();
  const phone = overrides?.phone ?? generateX25519KeyPair();
  const pairSecret = overrides?.pairSecret ?? new Uint8Array(32).fill(7);
  return {
    desk,
    phone,
    pairSecret,
    session: {
      machineId: "m1",
      machinePub: b64uEncode(desk.publicKey),
      deviceId: "d1",
      deviceToken: "tok",
      channel: "ctrl:m1:d1",
      relay: "ws://127.0.0.1:9/v1",
      pairSecret: b64uEncode(pairSecret),
      deviceSecretB64: b64uEncode(phone.secretKey),
      devicePubB64: b64uEncode(phone.publicKey),
      deviceLabel: "test",
    },
  };
}

describe("waitOpen (shipped)", () => {
  it("rejects on timeout when open never fires", async () => {
    const ws: WsLike = {
      send: () => {},
      close: () => {},
      readyState: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    await expect(waitOpen(ws, 40)).rejects.toThrow(/timeout/i);
  });

  it("resolves when open fires before timeout", async () => {
    const listeners = new Map<string, Array<() => void>>();
    const ws: WsLike = {
      send: () => {},
      close: () => {},
      readyState: 0,
      addEventListener: (type, fn) => {
        const arr = listeners.get(type) ?? [];
        arr.push(fn as () => void);
        listeners.set(type, arr);
      },
      removeEventListener: () => {},
    };
    const p = waitOpen(ws, 500);
    for (const fn of listeners.get("open") ?? []) fn();
    await expect(p).resolves.toBeUndefined();
  });
});

describe("RemoteGatewayClient.connect quality", () => {
  beforeEach(async () => {
    await clearOfflineQueue();
  });

  it("concurrent connect() calls share one in-flight Promise (no early success)", async () => {
    let createCount = 0;
    const createWs = vi.fn(async () => {
      createCount += 1;
      return {
        send: () => {},
        close: () => {},
        readyState: 0,
        addEventListener: () => {},
        removeEventListener: () => {},
      } satisfies WsLike;
    });

    const { session } = sessionFixture();
    const client = new RemoteGatewayClient(session, createWs, 50);
    const a = client.connect();
    const b = client.connect();
    expect(a).toBe(b);
    await expect(a).rejects.toThrow(/timeout|ws/i);
    expect(createCount).toBe(1);
    expect(client.isConnected).toBe(false);
  });

  it("after waitOpen timeout, a later connect can attempt again (not bricked)", async () => {
    const createWs = vi.fn(async () => {
      return {
        send: () => {},
        close: () => {},
        readyState: 0,
        addEventListener: () => {},
        removeEventListener: () => {},
      } satisfies WsLike;
    });
    const { session } = sessionFixture();
    const client = new RemoteGatewayClient(session, createWs, 40);
    await expect(client.connect()).rejects.toThrow(/timeout/i);
    await expect(client.connect()).rejects.toThrow(/timeout/i);
    expect(createWs).toHaveBeenCalledTimes(2);
  });

  it("closes the createWs socket after waitOpen timeout (no abandon leak)", async () => {
    const close = vi.fn();
    const createWs = vi.fn(async () => {
      return {
        send: () => {},
        close,
        readyState: 0,
        addEventListener: () => {},
        removeEventListener: () => {},
      } satisfies WsLike;
    });
    const { session } = sessionFixture();
    const client = new RemoteGatewayClient(session, createWs, 40);
    await expect(client.connect()).rejects.toThrow(/timeout/i);
    expect(close).toHaveBeenCalled();
    expect(client.isConnected).toBe(false);
  });

  it("emits Online (connect_ok) only after offline queue flush finishes", async () => {
    await saveOfflineQueue([
      createOfflineQueueItem(
        "memory.upsert",
        { kind: "preference", title: "t", content: "c" },
        "q-order",
      ),
    ]);

    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    const pairSecret = new Uint8Array(32).fill(9);
    const { session } = sessionFixture({ desk, phone, pairSecret });

    type Handler = (ev: { data: unknown }) => void;
    const msgHandlers: Handler[] = [];
    let rpcSeen = false;
    const events: string[] = [];

    const ws: WsLike = {
      readyState: 1,
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
          rpcSeen = true;
          events.push("rpc");
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
            const res = sealFrame(
              frameKey,
              serializeControlPlain({
                t: "res",
                id: plain.id,
                ok: true,
                result: { id: "m1" },
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
        if (type === "message") msgHandlers.push(fn as Handler);
        if (type === "open") queueMicrotask(() => (fn as () => void)());
      },
      removeEventListener: () => {},
    };

    const client = new RemoteGatewayClient(session, async () => ws, 200);
    client.onConnectionChange((m) => {
      if (m.state === "online") {
        events.push(`online:rpcSeen=${rpcSeen}`);
      }
    });
    await client.connect();
    expect(client.connection.state).toBe("online");
    // First online notification must come after the flush RPC was issued
    const onlineIdx = events.findIndex((e) => e.startsWith("online:"));
    expect(onlineIdx).toBeGreaterThan(-1);
    expect(events[onlineIdx]).toBe("online:rpcSeen=true");
    expect(events.indexOf("rpc")).toBeLessThan(onlineIdx);
    await clearOfflineQueue();
  });

  it("flush permanent failure surfaces queueError on connection model", async () => {
    await saveOfflineQueue([
      createOfflineQueueItem("memory.delete", { id: "ghost" }, "q-flush-err"),
    ]);

    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    const pairSecret = new Uint8Array(32).fill(3);
    const { session } = sessionFixture({ desk, phone, pairSecret });
    session.channel = "ctrl:m1:d1";

    type Handler = (ev: { data: unknown }) => void;
    const msgHandlers: Handler[] = [];

    const ws: WsLike = {
      readyState: 1,
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
            const res = sealFrame(
              frameKey,
              serializeControlPlain({
                t: "res",
                id: plain.id,
                ok: false,
                error: "permanent fail",
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
        if (type === "message") msgHandlers.push(fn as Handler);
        if (type === "open") queueMicrotask(() => (fn as () => void)());
      },
      removeEventListener: () => {},
    };

    const client = new RemoteGatewayClient(session, async () => ws, 200);
    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(client.connection.state).toBe("online");
    expect(client.connection.queueError).toMatch(/permanent fail/i);
    expect(client.connection.label).toMatch(/queue/i);
    await clearOfflineQueue();
  });
});
