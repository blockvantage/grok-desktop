import { z } from "zod";

/**
 * Default blind relay (hosted with the grokdesk.app landing stack).
 * Clients append `/v1` when missing. Local dev can override to
 * `ws://127.0.0.1:8787` (or another port) in Settings → Remote.
 */
export const DEFAULT_RELAY_URL = "wss://grokdesk.app/relay";

export const ControlPlainSchema = z.union([
  z.object({
    t: z.literal("req"),
    id: z.string().min(1).max(128),
    method: z.string().min(1).max(128),
    params: z.unknown(),
  }),
  z.object({
    t: z.literal("res"),
    id: z.string().min(1).max(128),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    t: z.literal("res"),
    id: z.string().min(1).max(128),
    ok: z.literal(false),
    error: z.string().max(8_000),
  }),
  z.object({
    t: z.literal("event"),
    channel: z.string().min(1).max(128),
    payload: z.unknown(),
  }),
  z.object({
    t: z.literal("hello"),
    role: z.enum(["desk", "phone"]),
    deviceId: z.string().min(1).max(128),
    /** 1 = legacy single-key frames; 2 = directional keys + AAD + replay window */
    protocol: z.union([z.literal(1), z.literal(2)]),
  }),
]);

/** Desk max supported remote control protocol. */
export const DESK_REMOTE_PROTOCOL_MAX = 2 as const;


export type ControlPlain = z.infer<typeof ControlPlainSchema>;

export function serializeControlPlain(plain: ControlPlain): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(plain));
}

export function parseControlPlain(bytes: Uint8Array): ControlPlain {
  const json = JSON.parse(new TextDecoder().decode(bytes));
  return ControlPlainSchema.parse(json);
}

/**
 * Bounds for pairing / relay string fields.
 * X25519 raw keys + 32-byte tokens are ~43 base64url chars; allow headroom
 * for encoding variants without accepting multi-KB DoS payloads.
 */
const PAIR_ID_MAX = 128;
const PAIR_KEY_MAX = 256;
const PAIR_TOKEN_MAX = 256;
const RELAY_CHANNEL_MAX = 256;
/** Base64url blob after outer relay maxPayload (~512 KiB) — keep schema tight. */
const RELAY_BLOB_MAX = 700_000;

export const PairOfferPlainSchema = z.object({
  v: z.literal(1),
  kind: z.literal("pair_offer"),
  deviceId: z.string().min(1).max(PAIR_ID_MAX),
  deviceLabel: z.string().min(1).max(64),
  devicePub: z.string().min(1).max(PAIR_KEY_MAX),
  pairSecret: z.string().min(1).max(PAIR_TOKEN_MAX),
});

export type PairOfferPlain = z.infer<typeof PairOfferPlainSchema>;

export const PairAcceptPlainSchema = z.object({
  v: z.literal(1),
  kind: z.literal("pair_accept"),
  machineId: z.string().min(1).max(PAIR_ID_MAX),
  machinePub: z.string().min(1).max(PAIR_KEY_MAX),
  deviceId: z.string().min(1).max(PAIR_ID_MAX),
  deviceToken: z.string().min(1).max(PAIR_TOKEN_MAX),
  channel: z.string().min(1).max(RELAY_CHANNEL_MAX),
});

export type PairAcceptPlain = z.infer<typeof PairAcceptPlainSchema>;

export function serializeJson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Relay cleartext envelopes (product payload always in blob). */
export const RelayClientMsgSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    role: z.enum(["desk", "phone"]),
    machineId: z.string().min(1).max(PAIR_ID_MAX),
    deviceId: z.string().min(1).max(PAIR_ID_MAX).optional(),
    token: z.string().min(1).max(PAIR_TOKEN_MAX),
  }),
  z.object({
    type: z.literal("send"),
    channel: z.string().min(1).max(RELAY_CHANNEL_MAX),
    blob: z.string().min(1).max(RELAY_BLOB_MAX),
  }),
  z.object({ type: z.literal("ping") }),
]);

export type RelayClientMsg = z.infer<typeof RelayClientMsgSchema>;

export function controlChannel(machineId: string, deviceId: string): string {
  return `ctrl:${machineId}:${deviceId}`;
}

export function pairChannel(machineId: string): string {
  return `pair:${machineId}`;
}
