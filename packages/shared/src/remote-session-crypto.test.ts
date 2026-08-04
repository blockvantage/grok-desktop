import { describe, it, expect } from "vitest";
import { generateX25519KeyPair } from "./remote-crypto.js";
import {
  createSessionCrypto,
  negotiateProtocol,
  openControlInbound,
  sealControlOutbound,
} from "./remote-session-crypto.js";

describe("remote session crypto dual-stack (REMOTE-02/06)", () => {
  const pairSecret = new Uint8Array(32).fill(11);

  it("negotiates highest common protocol", () => {
    expect(negotiateProtocol(1)).toBe(1);
    expect(negotiateProtocol(2)).toBe(2);
    expect(negotiateProtocol(3)).toBe(2);
    expect(negotiateProtocol(0)).toBeNull();
  });

  it("v1 still round-trips without replay tracking", () => {
    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    let state = createSessionCrypto({
      protocol: 1,
      mySecret: desk.secretKey,
      theirPublic: phone.publicKey,
      pairSecret,
      machineId: "m1",
      deviceId: "d1",
    });
    const plain = new TextEncoder().encode('{"t":"req","id":"1"}');
    const { sealed } = sealControlOutbound(state, plain, "s2c");
    // Phone side would use same frameKey — open as v1 inbound on desk mirror
    const phoneState = createSessionCrypto({
      protocol: 1,
      mySecret: phone.secretKey,
      theirPublic: desk.publicKey,
      pairSecret,
      machineId: "m1",
      deviceId: "d1",
    });
    // Desk outbound s2c opened by phone as... for v1 same key both ways
    const opened = openControlInbound(phoneState, sealed, "s2c");
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(new TextDecoder().decode(opened.plain)).toContain("req");
    }
  });

  it("v2 rejects exact replay of the same sealed frame", () => {
    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    let phoneState = createSessionCrypto({
      protocol: 2,
      mySecret: phone.secretKey,
      theirPublic: desk.publicKey,
      pairSecret,
      machineId: "m1",
      deviceId: "d1",
    });
    // Phone seals c2s to desk
    const sealedOut = sealControlOutbound(
      phoneState,
      new TextEncoder().encode('{"t":"req","id":"r1","method":"tasks.list"}'),
      "c2s",
    );
    phoneState = sealedOut.state;

    let deskState = createSessionCrypto({
      protocol: 2,
      mySecret: desk.secretKey,
      theirPublic: phone.publicKey,
      pairSecret,
      machineId: "m1",
      deviceId: "d1",
    });

    const first = openControlInbound(deskState, sealedOut.sealed, "c2s");
    expect(first.ok).toBe(true);
    if (first.ok) deskState = first.state;

    const replay = openControlInbound(deskState, sealedOut.sealed, "c2s");
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe("replay");
  });

  it("v2 rejects wrong device AAD (cross-device misuse)", () => {
    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    let phoneState = createSessionCrypto({
      protocol: 2,
      mySecret: phone.secretKey,
      theirPublic: desk.publicKey,
      pairSecret,
      machineId: "m1",
      deviceId: "device-a",
    });
    const { sealed } = sealControlOutbound(
      phoneState,
      new TextEncoder().encode("hi"),
      "c2s",
    );
    const deskAsB = createSessionCrypto({
      protocol: 2,
      mySecret: desk.secretKey,
      theirPublic: phone.publicKey,
      pairSecret,
      machineId: "m1",
      deviceId: "device-b", // different device
    });
    const opened = openControlInbound(deskAsB, sealed, "c2s");
    expect(opened.ok).toBe(false);
  });
});
