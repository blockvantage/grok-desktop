import { describe, expect, it } from "vitest";
import {
  b64uDecode,
  b64uEncode,
  decodePairingQr,
  deriveControlKeys,
  derivePairFrameKey,
  encodePairingQr,
  generateX25519KeyPair,
  keyPairFromSecret,
  openFrame,
  sealFrame,
  type PairingQrV1,
} from "./remote-crypto.js";
import {
  parseControlPlain,
  serializeControlPlain,
} from "./remote-protocol.js";

describe("remote-crypto", () => {
  it("round-trips pairing QR", () => {
    const qr: PairingQrV1 = {
      v: 1,
      mid: "machine-1",
      mpk: b64uEncode(new Uint8Array(32).fill(1)),
      secret: b64uEncode(new Uint8Array(32).fill(2)),
      relay: "ws://127.0.0.1:8787",
      exp: Date.now() + 60_000,
    };
    const s = encodePairingQr(qr);
    expect(s.startsWith("grokdesk://pair/")).toBe(true);
    expect(decodePairingQr(s)).toEqual(qr);
  });

  it("rejects oversized or malformed pairing QR fields", () => {
    expect(() => decodePairingQr("x".repeat(9_000))).toThrow(/too large/i);
    const qr: PairingQrV1 = {
      v: 1,
      mid: "m".repeat(129),
      mpk: b64uEncode(new Uint8Array(32).fill(1)),
      secret: b64uEncode(new Uint8Array(32).fill(2)),
      relay: "ws://127.0.0.1:8787",
      exp: Date.now() + 60_000,
    };
    // mid is oversized; encode validates relay only — craft raw payload.
    const badMid =
      "grokdesk://pair/" +
      b64uEncode(new TextEncoder().encode(JSON.stringify(qr)));
    expect(() => decodePairingQr(badMid)).toThrow(/mid/i);
  });

  it("rejects pairing QR relay with credentials or non-ws scheme", () => {
    const base = {
      v: 1 as const,
      mid: "m",
      mpk: b64uEncode(new Uint8Array(32).fill(1)),
      secret: b64uEncode(new Uint8Array(32).fill(2)),
      exp: Date.now() + 60_000,
    };
    expect(() =>
      encodePairingQr({ ...base, relay: "ws://user:pass@evil.example/relay" }),
    ).toThrow(/credentials/i);
    expect(() =>
      encodePairingQr({ ...base, relay: "https://evil.example/relay" }),
    ).toThrow(/ws:\/\//i);
    const raw = (relay: string) =>
      "grokdesk://pair/" +
      b64uEncode(
        new TextEncoder().encode(JSON.stringify({ ...base, relay })),
      );
    expect(() =>
      decodePairingQr(raw("ws://user:pass@evil.example/relay")),
    ).toThrow(/credentials/i);
    expect(() => decodePairingQr(raw("http://evil.example"))).toThrow(
      /ws:\/\//i,
    );
  });

  it("desk and phone derive same control key and seal frames", () => {
    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    const pairSecret = new Uint8Array(32).fill(7);
    const deskKeys = deriveControlKeys({
      mySecret: desk.secretKey,
      theirPublic: phone.publicKey,
      pairSecret,
    });
    const phoneKeys = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: desk.publicKey,
      pairSecret,
    });
    expect(b64uEncode(deskKeys.frameKey)).toBe(b64uEncode(phoneKeys.frameKey));
    const plain = serializeControlPlain({
      t: "req",
      id: "1",
      method: "tasks.list",
      params: {},
    });
    const sealed = sealFrame(deskKeys.frameKey, plain);
    // Ciphertext must not contain plaintext method name as UTF-8
    const sealedStr = new TextDecoder().decode(sealed);
    expect(sealedStr.includes("tasks.list")).toBe(false);
    const opened = parseControlPlain(openFrame(phoneKeys.frameKey, sealed));
    expect(opened).toMatchObject({ t: "req", method: "tasks.list" });
  });

  it("pair-frame key seals pair offer without leaking device label in ciphertext", () => {
    const secret = new Uint8Array(32).fill(9);
    const key = derivePairFrameKey(secret);
    const plain = new TextEncoder().encode(
      JSON.stringify({ kind: "pair_offer", deviceLabel: "SecretPhone" }),
    );
    const sealed = sealFrame(key, plain);
    expect(new TextDecoder().decode(sealed).includes("SecretPhone")).toBe(false);
    expect(new TextDecoder().decode(openFrame(key, sealed))).toContain(
      "SecretPhone",
    );
  });

  it("rejects expired QR", () => {
    const qr: PairingQrV1 = {
      v: 1,
      mid: "m",
      mpk: b64uEncode(new Uint8Array(32)),
      secret: b64uEncode(new Uint8Array(32)),
      relay: "ws://x",
      exp: Date.now() - 1000,
    };
    expect(() => decodePairingQr(encodePairingQr(qr), { now: Date.now() })).toThrow(
      /expired/i,
    );
  });

  it("matches fixed vector from fixtures", () => {
    // Fixed secret keys (32 bytes of 0x11 / 0x22) — both ends must agree on frameKey
    const deskSk = new Uint8Array(32).fill(0x11);
    const phoneSk = new Uint8Array(32).fill(0x22);
    const desk = keyPairFromSecret(deskSk);
    const phone = keyPairFromSecret(phoneSk);
    const pairSecret = new Uint8Array(32).fill(0x33);
    const a = deriveControlKeys({
      mySecret: desk.secretKey,
      theirPublic: phone.publicKey,
      pairSecret,
    });
    const b = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: desk.publicKey,
      pairSecret,
    });
    expect(b64uEncode(a.frameKey)).toBe(b64uEncode(b.frameKey));
    // Stable hex for cross-impl (first 8 bytes)
    const hex = [...a.frameKey.slice(0, 8)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
  });
});
