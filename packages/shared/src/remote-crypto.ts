/**
 * Remote access crypto: QR codec, X25519 ECDH, HKDF session keys, XChaCha20-Poly1305 frames.
 * Browser/RN/Node safe (no node: builtins).
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";

export type PairingQrV1 = {
  v: 1;
  mid: string;
  mpk: string;
  secret: string;
  relay: string;
  exp: number;
};

export type X25519KeyPair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

const QR_PREFIX = "grokdesk://pair/";
const SALT = new TextEncoder().encode("grokdesk-remote-v1");

export function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(bin)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const raw =
    typeof atob !== "undefined"
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, "base64").toString("binary");
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function generateX25519KeyPair(): X25519KeyPair {
  const secretKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(secretKey);
  return { publicKey, secretKey };
}

export function keyPairFromSecret(secretKey: Uint8Array): X25519KeyPair {
  if (secretKey.length !== 32) throw new Error("secretKey must be 32 bytes");
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function encodePairingQr(qr: PairingQrV1): string {
  // Fail closed on desk-side encode so a poisoned config never ships a
  // credential-bearing or non-ws relay into the QR payload.
  const safe: PairingQrV1 = {
    ...qr,
    relay: assertPairingRelayUrl(qr.relay),
  };
  return QR_PREFIX + b64uEncode(new TextEncoder().encode(JSON.stringify(safe)));
}

/**
 * Pairing QR relay must be bare ws/wss (no embedded credentials).
 * Shared by encode/decode so desk and phone reject the same footguns.
 */
export function assertPairingRelayUrl(relay: string): string {
  const raw = String(relay ?? "").trim().replace(/\/$/, "");
  if (!raw || raw.length > 2_048) throw new Error("Invalid relay");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid relay");
  }
  const proto = u.protocol.toLowerCase();
  if (proto !== "ws:" && proto !== "wss:") {
    throw new Error("Relay must use ws:// or wss://");
  }
  if (u.username || u.password) {
    throw new Error("Relay must not include credentials");
  }
  if (!u.hostname) throw new Error("Invalid relay");
  return raw;
}

export function decodePairingQr(
  raw: string,
  opts?: { now?: number },
): PairingQrV1 {
  const s = raw.trim();
  // QR payloads are small; refuse multi-KB strings before base64 decode work.
  if (s.length > 8_192) throw new Error("Pairing QR too large");
  if (!s.startsWith(QR_PREFIX)) throw new Error("Invalid pairing QR prefix");
  const json = new TextDecoder().decode(b64uDecode(s.slice(QR_PREFIX.length)));
  if (json.length > 4_096) throw new Error("Pairing QR payload too large");
  const qr = JSON.parse(json) as PairingQrV1;
  if (qr.v !== 1) throw new Error("Unsupported pairing QR version");
  if (typeof qr.mid !== "string" || !qr.mid || qr.mid.length > 128) {
    throw new Error("Invalid mid");
  }
  if (typeof qr.relay !== "string") {
    throw new Error("Invalid relay");
  }
  qr.relay = assertPairingRelayUrl(qr.relay);
  if (typeof qr.exp !== "number" || !Number.isFinite(qr.exp)) {
    throw new Error("Invalid exp");
  }
  const now = opts?.now ?? Date.now();
  if (qr.exp < now) throw new Error("Pairing QR expired");
  if (typeof qr.mpk !== "string" || qr.mpk.length > 256) {
    throw new Error("Invalid mpk");
  }
  if (typeof qr.secret !== "string" || qr.secret.length > 256) {
    throw new Error("Invalid secret");
  }
  if (b64uDecode(qr.mpk).length !== 32) throw new Error("Invalid mpk");
  if (b64uDecode(qr.secret).length !== 32) throw new Error("Invalid secret");
  return qr;
}

/** Pairing-channel key (both sides know QR secret). Relay never holds this. */
export function derivePairFrameKey(pairSecret: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    pairSecret,
    SALT,
    new TextEncoder().encode("pair-frame"),
    32,
  );
}

/** Long-term control channel key after ECDH + pair secret mix. */
export function deriveControlKeys(args: {
  mySecret: Uint8Array;
  theirPublic: Uint8Array;
  pairSecret: Uint8Array;
}): { frameKey: Uint8Array } {
  const shared = x25519.getSharedSecret(args.mySecret, args.theirPublic);
  const ikm = new Uint8Array(shared.length + args.pairSecret.length);
  ikm.set(shared, 0);
  ikm.set(args.pairSecret, shared.length);
  const frameKey = hkdf(
    sha256,
    ikm,
    SALT,
    new TextEncoder().encode("control-frame"),
    32,
  );
  return { frameKey };
}

export function sealFrame(frameKey: Uint8Array, plain: Uint8Array): Uint8Array {
  if (frameKey.length !== 32) throw new Error("frameKey must be 32 bytes");
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(frameKey, nonce);
  const ct = cipher.encrypt(plain);
  const out = new Uint8Array(24 + ct.length);
  out.set(nonce, 0);
  out.set(ct, 24);
  return out;
}

export function openFrame(frameKey: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (frameKey.length !== 32) throw new Error("frameKey must be 32 bytes");
  if (sealed.length < 25) throw new Error("Frame too short");
  const nonce = sealed.slice(0, 24);
  const ct = sealed.slice(24);
  const cipher = xchacha20poly1305(frameKey, nonce);
  return cipher.decrypt(ct);
}

export function randomToken(bytes = 32): string {
  return b64uEncode(randomBytes(bytes));
}

export function randomBytes32(): Uint8Array {
  return randomBytes(32);
}

// ── Protocol v2: directional keys, AAD, replay window ──────────────────────

const SALT_V2 = new TextEncoder().encode("grokdesk-remote-v2");

export type FrameDirection = "c2s" | "s2c" | "media";

export interface ControlKeySetV2 {
  /** Client → server control */
  c2s: Uint8Array;
  /** Server → client control */
  s2c: Uint8Array;
  /** Media / telepresence frames */
  media: Uint8Array;
}

/**
 * Derive directional control/media keys (protocol v2).
 * V1 deriveControlKeys remains for compatibility during migration.
 */
export function deriveControlKeysV2(args: {
  mySecret: Uint8Array;
  theirPublic: Uint8Array;
  pairSecret: Uint8Array;
}): ControlKeySetV2 {
  const shared = x25519.getSharedSecret(args.mySecret, args.theirPublic);
  const ikm = new Uint8Array(shared.length + args.pairSecret.length);
  ikm.set(shared, 0);
  ikm.set(args.pairSecret, shared.length);
  const root = hkdf(sha256, ikm, SALT_V2, new TextEncoder().encode("root"), 32);
  return {
    c2s: hkdf(sha256, root, SALT_V2, new TextEncoder().encode("ctrl-c2s"), 32),
    s2c: hkdf(sha256, root, SALT_V2, new TextEncoder().encode("ctrl-s2c"), 32),
    media: hkdf(
      sha256,
      root,
      SALT_V2,
      new TextEncoder().encode("media"),
      32,
    ),
  };
}

export interface FrameAadV2 {
  protocol: number;
  machineId: string;
  deviceId: string;
  channel: string;
  direction: FrameDirection;
  epoch: number;
  seq: number;
}

/** Canonical AAD bytes bound into AEAD for protocol v2 frames. */
export function encodeFrameAadV2(aad: FrameAadV2): Uint8Array {
  const s = [
    `v=${aad.protocol}`,
    `m=${aad.machineId}`,
    `d=${aad.deviceId}`,
    `c=${aad.channel}`,
    `dir=${aad.direction}`,
    `e=${aad.epoch}`,
    `s=${aad.seq}`,
  ].join("|");
  return new TextEncoder().encode(s);
}

/**
 * Seal a v2 frame: nonce(24) || seq(8 BE) || epoch(4 BE) || ciphertext.
 * AAD binds machine/device/channel/direction/epoch/seq.
 */
export function sealFrameV2(
  frameKey: Uint8Array,
  plain: Uint8Array,
  aad: FrameAadV2,
): Uint8Array {
  if (frameKey.length !== 32) throw new Error("frameKey must be 32 bytes");
  if (!Number.isInteger(aad.seq) || aad.seq < 0) {
    throw new Error("seq must be a non-negative integer");
  }
  const nonce = randomBytes(24);
  const aadBytes = encodeFrameAadV2(aad);
  // AAD is bound at construction for @noble/ciphers xchacha20poly1305
  const cipher = xchacha20poly1305(frameKey, nonce, aadBytes);
  const ct = cipher.encrypt(plain);
  const header = new Uint8Array(24 + 8 + 4);
  header.set(nonce, 0);
  const view = new DataView(header.buffer);
  view.setBigUint64(24, BigInt(aad.seq), false);
  view.setUint32(32, aad.epoch >>> 0, false);
  const out = new Uint8Array(header.length + ct.length);
  out.set(header, 0);
  out.set(ct, header.length);
  return out;
}

export function openFrameV2(
  frameKey: Uint8Array,
  sealed: Uint8Array,
  aadBase: Omit<FrameAadV2, "seq" | "epoch">,
): { plain: Uint8Array; seq: number; epoch: number } {
  if (frameKey.length !== 32) throw new Error("frameKey must be 32 bytes");
  if (sealed.length < 24 + 8 + 4 + 16) throw new Error("Frame too short");
  const nonce = sealed.slice(0, 24);
  const view = new DataView(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  const seq = Number(view.getBigUint64(24, false));
  const epoch = view.getUint32(32, false);
  const ct = sealed.slice(36);
  const aad = encodeFrameAadV2({ ...aadBase, seq, epoch });
  const cipher = xchacha20poly1305(frameKey, nonce, aad);
  const plain = cipher.decrypt(ct);
  return { plain, seq, epoch };
}

/**
 * Sliding replay window for one direction of a session epoch.
 * Accepts seq in [maxSeen - window, maxSeen] only if not already seen;
 * always accepts seq > maxSeen.
 */
export class ReplayWindow {
  private maxSeen = -1;
  private seen = new Set<number>();

  constructor(private windowSize = 64) {
    if (windowSize < 1) throw new Error("windowSize must be >= 1");
  }

  /** Returns true if seq should be accepted (and records it). */
  accept(seq: number): boolean {
    if (!Number.isInteger(seq) || seq < 0) return false;
    if (seq > this.maxSeen) {
      this.maxSeen = seq;
      this.seen.add(seq);
      this.prune();
      return true;
    }
    if (seq <= this.maxSeen - this.windowSize) {
      return false; // too old
    }
    if (this.seen.has(seq)) return false; // replay
    this.seen.add(seq);
    return true;
  }

  get highWater(): number {
    return this.maxSeen;
  }

  private prune(): void {
    const min = this.maxSeen - this.windowSize;
    for (const s of this.seen) {
      if (s < min) this.seen.delete(s);
    }
  }
}
