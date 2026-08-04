import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  b64uDecode,
  b64uEncode,
  decodePairingQr,
  deriveControlKeys,
  encodePairingQr,
  generateX25519KeyPair,
  isRemoteAllowedMethod,
} from "@grokdesk/shared";
import { openDatabase } from "../db.js";
import {
  loadRemoteConfig,
  RemoteService,
  saveRemoteConfig,
  type RemoteConfig,
} from "./remote.js";

describe("RemoteService", () => {
  let dir: string;
  let db: ReturnType<typeof openDatabase>;
  let cfg: RemoteConfig;
  let remote: RemoteService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-remote-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    cfg = loadRemoteConfig(db);
    remote = new RemoteService(db, {
      machineId: "mach-1",
      getConfig: () => cfg,
      setConfig: (partial) => {
        cfg = { ...cfg, ...partial };
        saveRemoteConfig(db, cfg);
        return cfg;
      },
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates remote_devices at schema v3", () => {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(Number(row.value)).toBeGreaterThanOrEqual(3);
  });

  it("startPairing returns scannable QR after enable", () => {
    remote.enable("ws://127.0.0.1:8787");
    const { qrString, challengeId } = remote.startPairing({ ttlMs: 60_000 });
    expect(challengeId).toBeTruthy();
    const qr = decodePairingQr(qrString);
    expect(qr.mid).toBe("mach-1");
    expect(qr.relay).toContain("8787");
    // Loopback is rewritten to a LAN IPv4 so the phone can reach the desk
    expect(qr.relay).not.toMatch(/127\.0\.0\.1|localhost/i);
  });

  it("startPairing keeps non-loopback relay hosts as-is", () => {
    remote.enable("ws://192.0.2.10:8788");
    const { qrString } = remote.startPairing({ ttlMs: 60_000 });
    const qr = decodePairingQr(qrString);
    expect(qr.relay).toBe("ws://192.0.2.10:8788");
  });

  it("default enable uses production relay and keeps it in the QR", () => {
    remote.enable();
    expect(remote.status().relayUrl).toBe("wss://grokdesk.app/relay");
    const { qrString } = remote.startPairing({ ttlMs: 60_000 });
    const qr = decodePairingQr(qrString);
    expect(qr.relay).toBe("wss://grokdesk.app/relay");
  });

  it("rejects non-ws relay schemes on enable", () => {
    expect(() => remote.enable("https://evil.example/relay")).toThrow(/ws:\/\/ or wss:\/\//);
    expect(() => remote.enable("file:///etc/passwd")).toThrow(/ws:\/\/ or wss:\/\//);
    expect(() => remote.enable("ws://user:pass@relay.example/")).toThrow(
      /credentials/,
    );
  });

  it("accepts pair offer, lists device, derives shared control key", () => {
    remote.enable();
    const { qrString } = remote.startPairing({ ttlMs: 60_000 });
    const qr = decodePairingQr(qrString);
    const phone = generateX25519KeyPair();
    const accept = remote.acceptPairOffer({
      deviceId: "dev-1",
      deviceLabel: "Test Phone",
      devicePub: b64uEncode(phone.publicKey),
      pairSecret: qr.secret,
    });
    expect(accept.deviceId).toBe("dev-1");
    expect(accept.channel).toBe("ctrl:mach-1:dev-1");
    expect(remote.listDevices().some((d) => d.id === "dev-1" && !d.revokedAt)).toBe(
      true,
    );
    const machine = remote.getMachineKeyPair();
    const deskKeys = deriveControlKeys({
      mySecret: machine.secretKey,
      theirPublic: phone.publicKey,
      pairSecret: b64uDecode(qr.secret),
    });
    const phoneKeys = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: machine.publicKey,
      pairSecret: b64uDecode(qr.secret),
    });
    expect(b64uEncode(deskKeys.frameKey)).toBe(b64uEncode(phoneKeys.frameKey));
  });

  it("revoke blocks device and clears session material", () => {
    remote.enable();
    const { qrString } = remote.startPairing({ ttlMs: 60_000 });
    const qr = decodePairingQr(qrString);
    const phone = generateX25519KeyPair();
    remote.acceptPairOffer({
      deviceId: "dev-2",
      deviceLabel: "X",
      devicePub: b64uEncode(phone.publicKey),
      pairSecret: qr.secret,
    });
    expect(remote.getDeviceSessionMaterial("dev-2")).toBeTruthy();
    remote.revokeDevice("dev-2");
    expect(remote.isDeviceActive("dev-2")).toBe(false);
    expect(remote.getDeviceSessionMaterial("dev-2")).toBeNull();
  });

  it("rekey rejects non-32-byte device public keys", () => {
    remote.enable();
    const { qrString } = remote.startPairing({ ttlMs: 60_000 });
    const qr = decodePairingQr(qrString);
    const phone = generateX25519KeyPair();
    remote.acceptPairOffer({
      deviceId: "dev-rekey",
      deviceLabel: "R",
      devicePub: b64uEncode(phone.publicKey),
      pairSecret: qr.secret,
    });
    expect(() => remote.updateDevicePublicKey("dev-rekey", "short")).toThrow(
      /Invalid device public key/,
    );
    const next = generateX25519KeyPair();
    expect(() =>
      remote.updateDevicePublicKey("dev-rekey", b64uEncode(next.publicKey)),
    ).not.toThrow();
  });

  it("pruneExpiredChallenges removes old rows", () => {
    remote.enable();
    remote.startPairing({ ttlMs: 60_000 });
    db.prepare(`UPDATE remote_pair_challenges SET expires_at = ?`).run(
      new Date(Date.now() - 1000).toISOString(),
    );
    expect(remote.pruneExpiredChallenges()).toBeGreaterThanOrEqual(1);
  });

  it("assertMethodAllowed enforces allowlist", () => {
    expect(() => remote.assertMethodAllowed("tasks.list")).not.toThrow();
    expect(() => remote.assertMethodAllowed("schedule.list")).not.toThrow();
    expect(() => remote.assertMethodAllowed("schedule.create")).not.toThrow();
    expect(() => remote.assertMethodAllowed("schedule.setEnabled")).not.toThrow();
    expect(() => remote.assertMethodAllowed("memory.list")).not.toThrow();
    expect(() => remote.assertMethodAllowed("memory.upsert")).not.toThrow();
    expect(() => remote.assertMethodAllowed("memory.delete")).not.toThrow();
    expect(() =>
      remote.assertMethodAllowed("remote.telepresence.listDisplays"),
    ).not.toThrow();
    expect(() => remote.assertMethodAllowed("auth.signIn")).toThrow(/not allowed/i);
    expect(isRemoteAllowedMethod("license.activate")).toBe(false);
  });

  it("startPairing fails when remote is disabled", () => {
    expect(remote.status().enabled).toBe(false);
    expect(() => remote.startPairing({ ttlMs: 30_000 })).toThrow(/disabled/i);
  });

  it("expired pairing secret cannot be accepted", () => {
    remote.enable();
    const { qrString } = remote.startPairing({ ttlMs: 60_000 });
    // Decode while still valid, then expire the challenge in DB
    const qr = decodePairingQr(qrString);
    db.prepare(`UPDATE remote_pair_challenges SET expires_at = ?`).run(
      new Date(Date.now() - 60_000).toISOString(),
    );
    const phone = generateX25519KeyPair();
    expect(() =>
      remote.acceptPairOffer({
        deviceId: "late",
        deviceLabel: "Late",
        devicePub: b64uEncode(phone.publicKey),
        pairSecret: qr.secret,
      }),
    ).toThrow(/expired/i);
  });

  it("decodePairingQr rejects expired QR payload", () => {
    remote.enable();
    const { qrString } = remote.startPairing({ ttlMs: 60_000 });
    const qr = decodePairingQr(qrString);
    expect(() =>
      decodePairingQr(encodePairingQr({ ...qr, exp: Date.now() - 1000 })),
    ).toThrow(/expired/i);
  });

  it("disabled after enable blocks new pairing", () => {
    remote.enable();
    remote.disable();
    expect(() => remote.startPairing()).toThrow(/disabled/i);
  });
});
