import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import os from "node:os";
import type { Db } from "../db.js";
import {
  b64uDecode,
  b64uEncode,
  DEFAULT_RELAY_URL,
  encodePairingQr,
  generateX25519KeyPair,
  isRemoteAllowedMethod,
  keyPairFromSecret,
  randomToken,
  type PairAcceptPlain,
  type X25519KeyPair,
} from "@grokdesk/shared";

export type RemoteDeviceRow = {
  id: string;
  label: string;
  publicKey: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type RemoteConfig = {
  enabled: boolean;
  relayUrl: string;
  deskToken: string | null;
  machineSecretB64: string | null;
  machinePubB64: string | null;
};

export type RemoteHostHooks = {
  machineId: string;
  getConfig: () => RemoteConfig;
  setConfig: (partial: Partial<RemoteConfig>) => RemoteConfig;
  /** Fired when remote access is enabled/disabled so the session host can connect. */
  onEnabledChange?: (enabled: boolean) => void;
  /** UI push: remote status / devices changed. */
  onRemoteChanged?: () => void;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Constant-time compare of base64url digests (same length after hash). */
function hashEquals(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

const DEFAULT_RELAY = DEFAULT_RELAY_URL;

/**
 * Only ws/wss relays are supported. Rejects file/http/javascript and bare
 * garbage so enable cannot store a URL the WebSocket client will mishandle.
 */
export function assertValidRelayUrl(relayUrl: string): string {
  const raw = relayUrl.trim();
  if (!raw) throw new Error("Relay URL is required");
  if (raw.length > 2_048) throw new Error("Relay URL is too long");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid relay URL");
  }
  const proto = u.protocol.toLowerCase();
  if (proto !== "ws:" && proto !== "wss:") {
    throw new Error("Relay URL must use ws:// or wss://");
  }
  if (u.username || u.password) {
    throw new Error("Relay URL must not include credentials");
  }
  if (!u.hostname) {
    throw new Error("Relay URL must include a host");
  }
  return raw.replace(/\/$/, "");
}

/** First non-internal IPv4 (LAN) address, if any. */
export function pickLanIPv4(): string | null {
  const ifs = os.networkInterfaces();
  for (const entries of Object.values(ifs)) {
    for (const a of entries ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

/**
 * QR is scanned on the phone. Loopback in the desk config is fine for the
 * desk process, but the phone must reach the Mac over the LAN — rewrite
 * 127.0.0.1 / localhost to a LAN IPv4 when embedding the relay in the QR.
 */
export function relayUrlForPairingQr(relayUrl: string): string {
  const raw = (relayUrl || DEFAULT_RELAY).trim().replace(/\/$/, "");
  try {
    const httpish = raw.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    const u = new URL(httpish);
    const host = u.hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
      const lan = pickLanIPv4();
      if (lan) {
        u.hostname = lan;
        const out = u.toString().replace(/\/$/, "");
        if (/^wss:/i.test(raw) || /^https:/i.test(httpish)) {
          return out.replace(/^https:/i, "wss:");
        }
        return out.replace(/^http:/i, "ws:");
      }
    }
  } catch {
    /* keep original */
  }
  return raw;
}

export class RemoteService {
  constructor(
    private db: Db,
    private hooks: RemoteHostHooks,
  ) {}

  status() {
    const cfg = this.hooks.getConfig();
    return {
      enabled: cfg.enabled,
      relayUrl: cfg.relayUrl || DEFAULT_RELAY,
      machineId: this.hooks.machineId,
      deviceCount: this.listDevices().filter((d) => !d.revokedAt).length,
      hasDeskToken: Boolean(cfg.deskToken),
    };
  }

  enable(relayUrl?: string) {
    const cfg = this.hooks.getConfig();
    const kp = this.ensureMachineKeyPair(cfg);
    const deskToken = cfg.deskToken ?? randomToken(32);
    const resolved =
      relayUrl != null && relayUrl.trim()
        ? assertValidRelayUrl(relayUrl)
        : cfg.relayUrl || DEFAULT_RELAY;
    // Re-validate stored/default URL so a poisoned config cannot stay enabled.
    const safeRelay = assertValidRelayUrl(resolved);
    this.hooks.setConfig({
      enabled: true,
      relayUrl: safeRelay,
      deskToken,
      machineSecretB64: b64uEncode(kp.secretKey),
      machinePubB64: b64uEncode(kp.publicKey),
    });
    this.hooks.onEnabledChange?.(true);
    this.hooks.onRemoteChanged?.();
    return this.status();
  }

  disable() {
    this.hooks.setConfig({ enabled: false });
    this.hooks.onEnabledChange?.(false);
    this.hooks.onRemoteChanged?.();
    return this.status();
  }

  getDeskToken(): string | null {
    return this.hooks.getConfig().deskToken;
  }

  getMachineKeyPair(): X25519KeyPair {
    return this.ensureMachineKeyPair(this.hooks.getConfig());
  }

  private ensureMachineKeyPair(cfg: RemoteConfig): X25519KeyPair {
    if (cfg.machineSecretB64 && cfg.machinePubB64) {
      return keyPairFromSecret(b64uDecode(cfg.machineSecretB64));
    }
    const kp = generateX25519KeyPair();
    this.hooks.setConfig({
      machineSecretB64: b64uEncode(kp.secretKey),
      machinePubB64: b64uEncode(kp.publicKey),
    });
    return kp;
  }

  /** Drop expired pairing challenges (called on pair start / accept). */
  pruneExpiredChallenges(nowMs: number = Date.now()): number {
    const r = this.db
      .prepare(`DELETE FROM remote_pair_challenges WHERE expires_at < ?`)
      .run(new Date(nowMs).toISOString());
    return r.changes;
  }

  startPairing(opts: { ttlMs?: number } = {}): {
    qrString: string;
    challengeId: string;
    expiresAt: string;
    relayUrl: string;
  } {
    const cfg = this.hooks.getConfig();
    if (!cfg.enabled) throw new Error("Remote access is disabled");
    this.pruneExpiredChallenges();
    // Cap concurrent live challenges so startPairing spam cannot bloat SQLite
    // or leave many valid pair secrets in flight.
    const active = this.db
      .prepare(
        `SELECT COUNT(*) as c FROM remote_pair_challenges WHERE expires_at >= ?`,
      )
      .get(new Date().toISOString()) as { c: number };
    if (Number(active?.c ?? 0) >= 5) {
      this.db
        .prepare(
          `DELETE FROM remote_pair_challenges WHERE id IN (
             SELECT id FROM remote_pair_challenges
             ORDER BY created_at ASC LIMIT 1
           )`,
        )
        .run();
    }
    const ttlMs = opts.ttlMs ?? 120_000;
    const kp = this.ensureMachineKeyPair(cfg);
    const secret = randomToken(32);
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO remote_pair_challenges (id, secret_hash, secret_b64, machine_pub, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        challengeId,
        hashToken(secret),
        secret,
        b64uEncode(kp.publicKey),
        expiresAt,
        createdAt,
      );
    // Desk may keep ws://127.0.0.1 — phone needs a LAN-reachable host in the QR.
    const deskRelayUrl = cfg.relayUrl || DEFAULT_RELAY;
    const relayUrl = relayUrlForPairingQr(deskRelayUrl);
    const qrString = encodePairingQr({
      v: 1,
      mid: this.hooks.machineId,
      mpk: b64uEncode(kp.publicKey),
      secret,
      relay: relayUrl,
      exp: Date.parse(expiresAt),
    });
    return { qrString, challengeId, expiresAt, relayUrl };
  }

  acceptPairOffer(offer: {
    deviceId: string;
    deviceLabel: string;
    devicePub: string;
    pairSecret: string;
  }): PairAcceptPlain {
    const row = this.db
      .prepare(
        `SELECT id, secret_hash, expires_at FROM remote_pair_challenges
         WHERE secret_hash = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(hashToken(offer.pairSecret)) as
      | { id: string; secret_hash: string; expires_at: string }
      | undefined;
    if (!row) throw new Error("Unknown or expired pairing secret");
    if (Date.parse(row.expires_at) < Date.now()) {
      throw new Error("Pairing challenge expired");
    }
    // Validate device pub length
    if (b64uDecode(offer.devicePub).length !== 32) {
      throw new Error("Invalid device public key");
    }
    const deviceToken = randomToken(32);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO remote_devices (id, label, public_key, device_token_hash, pair_secret_b64, created_at, last_seen_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           public_key = excluded.public_key,
           device_token_hash = excluded.device_token_hash,
           pair_secret_b64 = excluded.pair_secret_b64,
           revoked_at = NULL,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(
        offer.deviceId,
        offer.deviceLabel.slice(0, 64),
        offer.devicePub,
        hashToken(deviceToken),
        offer.pairSecret,
        now,
        now,
      );
    this.db
      .prepare(`DELETE FROM remote_pair_challenges WHERE id = ?`)
      .run(row.id);
    this.hooks.onRemoteChanged?.();
    const kp = this.getMachineKeyPair();
    return {
      v: 1,
      kind: "pair_accept",
      machineId: this.hooks.machineId,
      machinePub: b64uEncode(kp.publicKey),
      deviceId: offer.deviceId,
      deviceToken,
      channel: `ctrl:${this.hooks.machineId}:${offer.deviceId}`,
    };
  }

  listDevices(limit = 100): RemoteDeviceRow[] {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 500);
    return this.db
      .prepare(
        `SELECT id, label, public_key as publicKey, created_at as createdAt,
                last_seen_at as lastSeenAt, revoked_at as revokedAt
         FROM remote_devices ORDER BY created_at DESC LIMIT ?`,
      )
      .all(lim) as RemoteDeviceRow[];
  }

  revokeDevice(deviceId: string): void {
    const now = new Date().toISOString();
    // Clear pairing material so the device cannot resume E2E after revoke.
    this.db
      .prepare(
        `UPDATE remote_devices
         SET revoked_at = ?, pair_secret_b64 = NULL, device_token_hash = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(now, hashToken(`revoked-${deviceId}-${now}`), deviceId);
    this.hooks.onRemoteChanged?.();
  }

  isDeviceActive(deviceId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT revoked_at as revokedAt FROM remote_devices WHERE id = ?`,
      )
      .get(deviceId) as { revokedAt: string | null } | undefined;
    return !!row && !row.revokedAt;
  }

  getDevicePublicKey(deviceId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT public_key as publicKey, revoked_at as revokedAt FROM remote_devices WHERE id = ?`,
      )
      .get(deviceId) as { publicKey: string; revokedAt: string | null } | undefined;
    if (!row || row.revokedAt) return null;
    return row.publicKey;
  }

  getDeviceSessionMaterial(deviceId: string): {
    publicKey: string;
    pairSecretB64: string;
  } | null {
    const row = this.db
      .prepare(
        `SELECT public_key as publicKey, pair_secret_b64 as pairSecretB64, revoked_at as revokedAt
         FROM remote_devices WHERE id = ?`,
      )
      .get(deviceId) as {
      publicKey: string;
      pairSecretB64: string | null;
      revokedAt: string | null;
    } | undefined;
    if (!row || row.revokedAt || !row.pairSecretB64) return null;
    return { publicKey: row.publicKey, pairSecretB64: row.pairSecretB64 };
  }

  verifyDeviceToken(deviceId: string, token: string): boolean {
    const row = this.db
      .prepare(
        `SELECT device_token_hash as h, revoked_at as revokedAt FROM remote_devices WHERE id = ?`,
      )
      .get(deviceId) as { h: string; revokedAt: string | null } | undefined;
    if (!row || row.revokedAt) return false;
    return hashEquals(row.h, hashToken(token));
  }

  touchDevice(deviceId: string): void {
    this.db
      .prepare(`UPDATE remote_devices SET last_seen_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), deviceId);
  }

  /**
   * CX-14: update device ECDH public key after phone rotates keys.
   * Pair secret and device token are unchanged; frame key re-derives.
   */
  updateDevicePublicKey(deviceId: string, devicePub: string): void {
    if (!this.isDeviceActive(deviceId)) {
      throw new Error("Device not active");
    }
    // Match acceptPairOffer: ECDH public keys must decode to 32 raw bytes.
    try {
      if (b64uDecode(devicePub).length !== 32) {
        throw new Error("Invalid device public key");
      }
    } catch {
      throw new Error("Invalid device public key");
    }
    this.db
      .prepare(
        `UPDATE remote_devices SET public_key = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(devicePub, new Date().toISOString(), deviceId);
    this.hooks.onRemoteChanged?.();
  }

  assertMethodAllowed(method: string): void {
    if (!isRemoteAllowedMethod(method)) {
      throw new Error(`Method not allowed over remote: ${method}`);
    }
  }

  /**
   * Open a sealed pair-channel blob using any non-expired challenge secret.
   * Returns plaintext bytes or null if no key works.
   */
  tryOpenPairBlob(
    sealed: Uint8Array,
    open: (key: Uint8Array, sealed: Uint8Array) => Uint8Array,
    deriveKey: (secret: Uint8Array) => Uint8Array,
  ): Uint8Array | null {
    // Challenges are capped (max 5); still filter expired at SQL so we do not
    // open with stale secrets or scan dead rows.
    const nowIso = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT secret_b64 as secretB64, expires_at as expiresAt
         FROM remote_pair_challenges
         WHERE expires_at >= ?
         ORDER BY created_at DESC
         LIMIT 5`,
      )
      .all(nowIso) as { secretB64: string; expiresAt: string }[];
    for (const row of rows) {
      try {
        const key = deriveKey(b64uDecode(row.secretB64));
        return open(key, sealed);
      } catch {
        /* try next */
      }
    }
    return null;
  }
}

/** Load/store remote config from the settings key-value table. */
export function loadRemoteConfig(db: Db): RemoteConfig {
  const row = db
    .prepare(`SELECT value_json FROM settings WHERE key = 'remote'`)
    .get() as { value_json: string } | undefined;
  if (!row) {
    return {
      enabled: false,
      relayUrl: DEFAULT_RELAY,
      deskToken: null,
      machineSecretB64: null,
      machinePubB64: null,
    };
  }
  try {
    const p = JSON.parse(row.value_json) as Partial<RemoteConfig>;
    return {
      enabled: Boolean(p.enabled),
      relayUrl: typeof p.relayUrl === "string" ? p.relayUrl : DEFAULT_RELAY,
      deskToken: typeof p.deskToken === "string" ? p.deskToken : null,
      machineSecretB64:
        typeof p.machineSecretB64 === "string" ? p.machineSecretB64 : null,
      machinePubB64:
        typeof p.machinePubB64 === "string" ? p.machinePubB64 : null,
    };
  } catch {
    return {
      enabled: false,
      relayUrl: DEFAULT_RELAY,
      deskToken: null,
      machineSecretB64: null,
      machinePubB64: null,
    };
  }
}

export function saveRemoteConfig(db: Db, cfg: RemoteConfig): void {
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES ('remote', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(JSON.stringify(cfg));
}
