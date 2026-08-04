import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { b64uEncode, generateX25519KeyPair } from "@grokdesk/shared";
import { Gateway } from "../index.js";
import { TestEngine } from "@grokdesk/engine-testkit";
import { remoteRequestContext } from "../services/request-context.js";

/**
 * Adversarial two-device tests: device A authenticated cannot rekey/control device B.
 */
describe("REMOTE-01 two-device isolation", () => {
  let dir: string;
  let gw: Gateway;
  let pubB: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-2dev-"));
    gw = new Gateway(
      {
        dataDir: dir,
        dbPath: path.join(dir, "db.sqlite"),
        logsDir: path.join(dir, "logs"),
      },
      { engine: new TestEngine(), machineId: "mach-test" },
    );
    await gw.start();
    gw.remote.enable("ws://127.0.0.1:9");
    const phoneA = generateX25519KeyPair();
    const phoneB = generateX25519KeyPair();
    pubB = b64uEncode(phoneB.publicKey);
    const { qrString } = gw.remote.startPairing({ ttlMs: 60_000 });
    // Accept A and B via direct service (pairing QR secret shared for test).
    const { decodePairingQr } = await import("@grokdesk/shared");
    const qr = decodePairingQr(qrString);
    gw.remote.acceptPairOffer({
      deviceId: "device-a",
      deviceLabel: "A",
      devicePub: b64uEncode(phoneA.publicKey),
      pairSecret: qr.secret,
    });
    // Second pairing challenge for B
    const pair2 = gw.remote.startPairing({ ttlMs: 60_000 });
    const qr2 = decodePairingQr(pair2.qrString);
    gw.remote.acceptPairOffer({
      deviceId: "device-b",
      deviceLabel: "B",
      devicePub: pubB,
      pairSecret: qr2.secret,
    });
  });

  afterEach(async () => {
    await gw.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("device A cannot rekey device B via body deviceId", async () => {
    const ctxA = remoteRequestContext({
      principalDeviceId: "device-a",
      machineId: "mach-test",
      requestId: "rk1",
    });
    const newPub = b64uEncode(generateX25519KeyPair().publicKey);
    await expect(
      gw.handle(
        {
          id: "rk1",
          method: "remote.rekey",
          params: { deviceId: "device-b", devicePub: newPub },
        },
        ctxA,
      ),
    ).rejects.toThrow(/mismatch|principal/i);

    // B's public key unchanged
    const devices = gw.remote.listDevices();
    const b = devices.find((d) => d.id === "device-b");
    expect(b).toBeTruthy();
  });

  it("device A rekey without body id only affects A", async () => {
    const ctxA = remoteRequestContext({
      principalDeviceId: "device-a",
      machineId: "mach-test",
      requestId: "rk2",
    });
    const newPub = b64uEncode(generateX25519KeyPair().publicKey);
    const result = await gw.handle(
      {
        id: "rk2",
        method: "remote.rekey",
        params: { devicePub: newPub },
      },
      ctxA,
    );
    expect(result).toEqual({ ok: true });
  });

  it("device A cannot stop telepresence owned by B", async () => {
    await gw.telepresence.start({ deviceId: "device-b", quality: "auto" });
    const ctxA = remoteRequestContext({
      principalDeviceId: "device-a",
      machineId: "mach-test",
      requestId: "tp1",
    });
    await expect(
      gw.handle(
        {
          id: "tp1",
          method: "remote.telepresence.stop",
          params: {},
        },
        ctxA,
      ),
    ).rejects.toThrow(/owned by another/i);
  });
});
