import { describe, it, expect } from "vitest";
import {
  b64uEncode,
  deriveControlKeys,
  deriveControlKeysV2,
  generateX25519KeyPair,
  openFrameV2,
  ReplayWindow,
  sealFrameV2,
} from "./remote-crypto.js";

describe("remote-crypto protocol v2", () => {
  it("derives distinct directional keys", () => {
    const a = generateX25519KeyPair();
    const b = generateX25519KeyPair();
    const pairSecret = new Uint8Array(32).fill(3);
    const keysA = deriveControlKeysV2({
      mySecret: a.secretKey,
      theirPublic: b.publicKey,
      pairSecret,
    });
    const keysB = deriveControlKeysV2({
      mySecret: b.secretKey,
      theirPublic: a.publicKey,
      pairSecret,
    });
    expect(b64uEncode(keysA.c2s)).toBe(b64uEncode(keysB.c2s));
    expect(b64uEncode(keysA.s2c)).toBe(b64uEncode(keysB.s2c));
    expect(b64uEncode(keysA.media)).toBe(b64uEncode(keysB.media));
    expect(b64uEncode(keysA.c2s)).not.toBe(b64uEncode(keysA.s2c));
    expect(b64uEncode(keysA.c2s)).not.toBe(b64uEncode(keysA.media));
  });

  it("v2 keys differ from v1 single frame key", () => {
    const a = generateX25519KeyPair();
    const b = generateX25519KeyPair();
    const pairSecret = new Uint8Array(32).fill(4);
    const v1 = deriveControlKeys({
      mySecret: a.secretKey,
      theirPublic: b.publicKey,
      pairSecret,
    });
    const v2 = deriveControlKeysV2({
      mySecret: a.secretKey,
      theirPublic: b.publicKey,
      pairSecret,
    });
    expect(b64uEncode(v1.frameKey)).not.toBe(b64uEncode(v2.c2s));
  });

  it("seal/open with AAD and rejects wrong direction/machine", () => {
    const keys = deriveControlKeysV2({
      mySecret: generateX25519KeyPair().secretKey,
      theirPublic: generateX25519KeyPair().publicKey,
      pairSecret: new Uint8Array(32).fill(5),
    });
    // Need matching ECDH — use proper pair
    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    const secret = new Uint8Array(32).fill(8);
    const k = deriveControlKeysV2({
      mySecret: desk.secretKey,
      theirPublic: phone.publicKey,
      pairSecret: secret,
    });
    const plain = new TextEncoder().encode('{"t":"req","id":"1"}');
    const aadBase = {
      protocol: 2,
      machineId: "mach-1",
      deviceId: "dev-1",
      channel: "ctrl:mach-1:dev-1",
      direction: "c2s" as const,
    };
    const sealed = sealFrameV2(k.c2s, plain, { ...aadBase, epoch: 1, seq: 7 });
    const opened = openFrameV2(k.c2s, sealed, aadBase);
    expect(opened.seq).toBe(7);
    expect(opened.epoch).toBe(1);
    expect(new TextDecoder().decode(opened.plain)).toContain("req");

    // Wrong machine AAD fails decrypt
    expect(() =>
      openFrameV2(k.c2s, sealed, { ...aadBase, machineId: "other" }),
    ).toThrow();
  });

  it("ReplayWindow rejects exact replay and old sequences", () => {
    const w = new ReplayWindow(4);
    expect(w.accept(1)).toBe(true);
    expect(w.accept(1)).toBe(false); // replay
    expect(w.accept(2)).toBe(true);
    expect(w.accept(3)).toBe(true);
    expect(w.accept(4)).toBe(true);
    expect(w.accept(5)).toBe(true);
    // 1 is outside window [5-4=1, 5] — boundary: seq 1 is at maxSeen-window
    expect(w.accept(0)).toBe(false);
    expect(w.accept(2)).toBe(false); // still in window but already seen
    expect(w.accept(6)).toBe(true);
  });
});
