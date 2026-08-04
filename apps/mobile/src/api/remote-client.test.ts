import { describe, expect, it } from "vitest";
import {
  b64uEncode,
  deriveControlKeys,
  generateX25519KeyPair,
  openFrame,
  parseControlPlain,
  sealFrame,
  serializeControlPlain,
} from "@grokdesk/shared/remote";
import { randomId, wsDataToString } from "./remote-client";

describe("wsDataToString", () => {
  it("passes through strings and decodes ArrayBuffer", () => {
    expect(wsDataToString('{"type":"pong"}')).toBe('{"type":"pong"}');
    const buf = new TextEncoder().encode('{"ok":true}');
    expect(wsDataToString(buf.buffer)).toBe('{"ok":true}');
  });
});

describe("randomId (RN-safe UUID)", () => {
  it("returns RFC4122-shaped ids without crypto.randomUUID", () => {
    const orig = globalThis.crypto;
    // Simulate Hermes/RN: getRandomValues only
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (a: Uint8Array) => {
          for (let i = 0; i < a.length; i++) a[i] = i + 1;
          return a;
        },
      },
    });
    try {
      const id = randomId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      // Same mock entropy → same id (proves path used getRandomValues, not randomUUID)
      expect(randomId()).toBe(id);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: orig,
      });
    }
  });
});

/**
 * Unit test of the shipped seal/open path used by RemoteGatewayClient.request
 * (ciphertext must not leak method names; peer key recovers plaintext).
 */
describe("mobile control framing (shipped crypto path)", () => {
  it("seals req so blob is not readable task JSON on the wire", () => {
    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    const pairSecret = new Uint8Array(32).fill(5);
    const { frameKey } = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: desk.publicKey,
      pairSecret,
    });
    const plain = serializeControlPlain({
      t: "req",
      id: "1",
      method: "tasks.list",
      params: { goal: "SECRET_GOAL_TEXT" },
    });
    const sealed = sealFrame(frameKey, plain);
    const wire = b64uEncode(sealed);
    expect(wire.includes("SECRET_GOAL_TEXT")).toBe(false);
    expect(wire.includes("tasks.list")).toBe(false);
    const opened = parseControlPlain(openFrame(frameKey, sealed));
    expect(opened).toMatchObject({
      t: "req",
      method: "tasks.list",
      params: { goal: "SECRET_GOAL_TEXT" },
    });
  });
});
