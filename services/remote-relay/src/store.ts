/**
 * In-memory blind channel router. Never inspects blob contents.
 */
import { timingSafeEqual } from "node:crypto";

export type Role = "desk" | "phone";

function tokensEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export type Peer = {
  id: string;
  role: Role;
  machineId: string;
  deviceId?: string;
  token: string;
  push: (msg: unknown) => void;
};

export type RecvMsg = {
  type: "recv";
  channel: string;
  blob: string;
  from: Role;
};

const MAX_BLOB_CHARS = 350_000; // ~256KB binary as base64 + margin
/** Soft cap on concurrent WS peers (desk + phones) per process. */
export const MAX_RELAY_PEERS = 2_000;
const MAX_CHANNEL_CHARS = 256;

export class RelayStore {
  private peers = new Map<string, Peer>();
  private deskTokenByMachine = new Map<string, string>();
  private deviceToken = new Map<string, string>(); // `${machineId}:${deviceId}` -> token
  private channelSubs = new Map<string, Set<string>>(); // channel -> peer ids
  private readonly maxPeers: number;

  constructor(opts?: { maxPeers?: number }) {
    this.maxPeers = Math.max(1, opts?.maxPeers ?? MAX_RELAY_PEERS);
  }

  register(peer: Peer): { ok: true } | { ok: false; code: string; message: string } {
    if (this.peers.size >= this.maxPeers && !this.peers.has(peer.id)) {
      return {
        ok: false,
        code: "capacity",
        message: "relay at peer capacity",
      };
    }
    if (peer.role === "desk") {
      const existing = this.deskTokenByMachine.get(peer.machineId);
      // CX-4: reject desk re-register with a different token (token continuity).
      // Same token (reconnect) is allowed; first-seen token is sticky.
      if (existing && !tokensEqual(existing, peer.token)) {
        return {
          ok: false,
          code: "token_mismatch",
          message: "desk token does not match registered machine",
        };
      }
      this.deskTokenByMachine.set(peer.machineId, peer.token);
    } else {
      if (!peer.deviceId) {
        return { ok: false, code: "bad_hello", message: "phone hello requires deviceId" };
      }
      // Personal devices: last hello wins (pair phase uses a temp token, then deviceToken).
      const key = `${peer.machineId}:${peer.deviceId}`;
      this.deviceToken.set(key, peer.token);
    }
    this.peers.set(peer.id, peer);
    // Auto-subscribe pair channel for desks; phones after pair use ctrl
    if (peer.role === "desk") {
      this.subscribe(peer.id, `pair:${peer.machineId}`);
    }
    return { ok: true };
  }

  unregister(peerId: string): void {
    this.peers.delete(peerId);
    for (const [, set] of this.channelSubs) {
      set.delete(peerId);
    }
  }

  subscribe(peerId: string, channel: string): void {
    let set = this.channelSubs.get(channel);
    if (!set) {
      set = new Set();
      this.channelSubs.set(channel, set);
    }
    set.add(peerId);
  }

  /**
   * Route an opaque blob. On first send to a ctrl channel from a phone,
   * auto-subscribe both ends when possible.
   */
  send(
    fromPeerId: string,
    channel: string,
    blob: string,
  ): { ok: true; delivered: number } | { ok: false; code: string; message: string } {
    const peer = this.peers.get(fromPeerId);
    if (!peer) {
      return { ok: false, code: "not_hello", message: "hello required first" };
    }
    if (typeof channel !== "string" || channel.length < 1 || channel.length > MAX_CHANNEL_CHARS) {
      return { ok: false, code: "bad_channel", message: "invalid channel" };
    }
    if (blob.length > MAX_BLOB_CHARS) {
      return { ok: false, code: "blob_too_large", message: "blob exceeds max size" };
    }
    if (!this.channelAllowed(peer, channel)) {
      return {
        ok: false,
        code: "channel_forbidden",
        message: "channel not allowed for this peer",
      };
    }
    // Ensure sender is subscribed so they can receive replies
    this.subscribe(fromPeerId, channel);
    // Desk always on pair + any ctrl for its machine
    if (peer.role === "desk" && channel.startsWith(`ctrl:${peer.machineId}:`)) {
      this.subscribe(fromPeerId, channel);
    }
    // Auto-sub desk to ctrl/tele when phone sends
    if (
      peer.role === "phone" &&
      (channel.startsWith(`ctrl:${peer.machineId}:`) ||
        channel.startsWith(`tele:${peer.machineId}:`))
    ) {
      for (const [id, p] of this.peers) {
        if (p.role === "desk" && p.machineId === peer.machineId) {
          this.subscribe(id, channel);
        }
      }
    }
    // Auto-sub phone to tele when desk sends frames
    if (peer.role === "desk" && channel.startsWith(`tele:${peer.machineId}:`)) {
      const deviceId = channel.split(":")[2];
      for (const [id, p] of this.peers) {
        if (
          p.role === "phone" &&
          p.machineId === peer.machineId &&
          p.deviceId === deviceId
        ) {
          this.subscribe(id, channel);
        }
      }
    }
    // Phone on pair channel during pairing
    if (peer.role === "phone" && channel === `pair:${peer.machineId}`) {
      this.subscribe(fromPeerId, channel);
      for (const [id, p] of this.peers) {
        if (p.role === "desk" && p.machineId === peer.machineId) {
          this.subscribe(id, channel);
        }
      }
    }

    const msg: RecvMsg = {
      type: "recv",
      channel,
      blob,
      from: peer.role,
    };
    let delivered = 0;
    const subs = this.channelSubs.get(channel) ?? new Set();
    for (const id of subs) {
      if (id === fromPeerId) continue;
      const target = this.peers.get(id);
      if (!target) continue;
      try {
        // push must actually hand off — if the peer socket is dead, count 0
        target.push(msg);
        delivered++;
      } catch {
        // ignore dead push
      }
    }
    // If phone is talking to a machine with no live desk, surface that clearly.
    if (
      delivered === 0 &&
      peer.role === "phone" &&
      (channel.startsWith("ctrl:") || channel.startsWith("pair:"))
    ) {
      const deskOnline = [...this.peers.values()].some(
        (p) => p.role === "desk" && p.machineId === peer.machineId,
      );
      if (!deskOnline) {
        return {
          ok: false,
          code: "desk_offline",
          message:
            "Desk is not connected to the relay — open Grok Desk and enable Remote",
        };
      }
    }
    return { ok: true, delivered };
  }

  private channelAllowed(peer: Peer, channel: string): boolean {
    if (channel === `pair:${peer.machineId}`) return true;
    if (peer.role === "desk" && channel.startsWith(`ctrl:${peer.machineId}:`)) {
      return true;
    }
    if (peer.role === "desk" && channel.startsWith(`tele:${peer.machineId}:`)) {
      return true;
    }
    if (
      peer.role === "phone" &&
      peer.deviceId &&
      channel === `ctrl:${peer.machineId}:${peer.deviceId}`
    ) {
      return true;
    }
    if (
      peer.role === "phone" &&
      peer.deviceId &&
      channel === `tele:${peer.machineId}:${peer.deviceId}`
    ) {
      return true;
    }
    // Phone may also use pair channel before device fully registered
    if (peer.role === "phone" && channel.startsWith("pair:")) {
      return channel === `pair:${peer.machineId}`;
    }
    return false;
  }

  /** For tests / metrics — never include blobs. */
  stats() {
    return {
      peers: this.peers.size,
      channels: this.channelSubs.size,
      machines: this.deskTokenByMachine.size,
    };
  }
}
