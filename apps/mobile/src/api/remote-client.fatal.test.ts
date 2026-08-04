/**
 * P4: fatal session path when control returns Device revoked.
 */
import { describe, expect, it, vi } from "vitest";
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

describe("RemoteGatewayClient fatal session (P4)", () => {
  it("fires onFatalSession once on Device revoked and stops reconnect", async () => {
    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    const pairSecret = new Uint8Array(32).fill(2);
    const session: StoredSession = {
      machineId: "m-fatal",
      machinePub: b64uEncode(desk.publicKey),
      deviceId: "d-fatal",
      deviceToken: "tok",
      channel: "ctrl:m-fatal:d-fatal",
      relay: "ws://test/v1",
      pairSecret: b64uEncode(pairSecret),
      deviceSecretB64: b64uEncode(phone.secretKey),
      devicePubB64: b64uEncode(phone.publicKey),
      deviceLabel: "f",
    };

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
                error: "Device revoked",
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
    client.enableAutoReconnect(true);
    const fatal = vi.fn();
    client.onFatalSession(fatal);
    // Connect health-checks with tasks.list — revoked answers must surface as fatal
    await expect(client.connect()).rejects.toThrow(/revoked|re-pair/i);
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal.mock.calls[0]![0].kind).toBe("revoked");
    // Further RPCs still reject; fatal only once
    await expect(client.request("tasks.list")).rejects.toThrow();
    expect(fatal).toHaveBeenCalledTimes(1);
  });
});
