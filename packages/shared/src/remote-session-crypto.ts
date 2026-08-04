/**
 * Remote control-frame codec with protocol v1/v2 dual support.
 * Pure helpers — unit tested without gateway/WebSocket.
 */
import {
  deriveControlKeys,
  deriveControlKeysV2,
  openFrame,
  openFrameV2,
  ReplayWindow,
  sealFrame,
  sealFrameV2,
  type ControlKeySetV2,
  type FrameDirection,
} from "./remote-crypto.js";

export const REMOTE_PROTOCOL_MIN = 1;
export const REMOTE_PROTOCOL_MAX = 2;

export type NegotiatedProtocol = 1 | 2;

export function negotiateProtocol(
  peerProtocol: number,
  localMin = REMOTE_PROTOCOL_MIN,
  localMax = REMOTE_PROTOCOL_MAX,
): NegotiatedProtocol | null {
  if (!Number.isInteger(peerProtocol)) return null;
  const chosen = Math.min(peerProtocol, localMax);
  if (chosen < localMin) return null;
  return chosen as NegotiatedProtocol;
}

export interface SessionCryptoState {
  protocol: NegotiatedProtocol;
  /** v1 single frame key */
  frameKey: Uint8Array;
  /** v2 directional keys */
  keysV2: ControlKeySetV2 | null;
  machineId: string;
  deviceId: string;
  channel: string;
  epoch: number;
  outSeq: number;
  /** Replay window for inbound control frames (c2s on desk). */
  inboundReplay: ReplayWindow;
}

export function createSessionCrypto(args: {
  protocol: NegotiatedProtocol;
  mySecret: Uint8Array;
  theirPublic: Uint8Array;
  pairSecret: Uint8Array;
  machineId: string;
  deviceId: string;
  epoch?: number;
}): SessionCryptoState {
  const channel = `ctrl:${args.machineId}:${args.deviceId}`;
  const v1 = deriveControlKeys({
    mySecret: args.mySecret,
    theirPublic: args.theirPublic,
    pairSecret: args.pairSecret,
  });
  const v2 =
    args.protocol >= 2
      ? deriveControlKeysV2({
          mySecret: args.mySecret,
          theirPublic: args.theirPublic,
          pairSecret: args.pairSecret,
        })
      : null;
  return {
    protocol: args.protocol,
    frameKey: v1.frameKey,
    keysV2: v2,
    machineId: args.machineId,
    deviceId: args.deviceId,
    channel,
    epoch: args.epoch ?? 1,
    outSeq: 0,
    inboundReplay: new ReplayWindow(64),
  };
}

/** Seal outbound control frame (desk → phone uses s2c on v2). */
export function sealControlOutbound(
  state: SessionCryptoState,
  plain: Uint8Array,
  direction: FrameDirection = "s2c",
): { sealed: Uint8Array; state: SessionCryptoState } {
  if (state.protocol === 1 || !state.keysV2) {
    return { sealed: sealFrame(state.frameKey, plain), state };
  }
  const seq = state.outSeq + 1;
  const key =
    direction === "c2s"
      ? state.keysV2.c2s
      : direction === "media"
        ? state.keysV2.media
        : state.keysV2.s2c;
  const sealed = sealFrameV2(key, plain, {
    protocol: 2,
    machineId: state.machineId,
    deviceId: state.deviceId,
    channel: state.channel,
    direction,
    epoch: state.epoch,
    seq,
  });
  return {
    sealed,
    state: { ...state, outSeq: seq },
  };
}

export type OpenControlResult =
  | { ok: true; plain: Uint8Array; state: SessionCryptoState }
  | { ok: false; reason: "decrypt" | "replay" | "epoch" };

/** Open inbound control frame (phone → desk uses c2s on v2). */
export function openControlInbound(
  state: SessionCryptoState,
  sealed: Uint8Array,
  direction: FrameDirection = "c2s",
): OpenControlResult {
  if (state.protocol === 1 || !state.keysV2) {
    try {
      const plain = openFrame(state.frameKey, sealed);
      return { ok: true, plain, state };
    } catch {
      return { ok: false, reason: "decrypt" };
    }
  }
  try {
    const key =
      direction === "c2s"
        ? state.keysV2.c2s
        : direction === "media"
          ? state.keysV2.media
          : state.keysV2.s2c;
    const { plain, seq, epoch } = openFrameV2(key, sealed, {
      protocol: 2,
      machineId: state.machineId,
      deviceId: state.deviceId,
      channel: state.channel,
      direction,
    });
    if (epoch !== state.epoch) {
      return { ok: false, reason: "epoch" };
    }
    if (!state.inboundReplay.accept(seq)) {
      return { ok: false, reason: "replay" };
    }
    return { ok: true, plain, state };
  } catch {
    return { ok: false, reason: "decrypt" };
  }
}
