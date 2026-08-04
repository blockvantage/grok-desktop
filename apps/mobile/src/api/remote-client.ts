/**
 * Phone remote client: pair + E2E gateway RPC over blind relay.
 * Works in RN (global WebSocket) and Node (ws package) for tests/e2e.
 * P2: reconnect with backoff, offline queue flush for safe mutations.
 */
import {
  b64uDecode,
  b64uEncode,
  classifyRemoteError,
  createSessionCrypto,
  decodePairingQr,
  derivePairFrameKey,
  flushOfflineQueue,
  generateX25519KeyPair,
  initialConnectionModel,
  isOfflineQueueableMethod,
  nextBackoffMs,
  openControlInbound,
  openFrame,
  parseControlPlain,
  parseJsonBytes,
  PairAcceptPlainSchema,
  reduceConnection,
  remoteErrorLabel,
  sealControlOutbound,
  sealFrame,
  serializeControlPlain,
  serializeJson,
  shouldKeepReconnecting,
  teleChannel,
  type ClassifiedRemoteError,
  type ConnectionModel,
  type ControlPlain,
  type OfflineQueueItem,
  type SessionCryptoState,
  type TeleFramePlain,
  type TelepresenceQuality,
  type X25519KeyPair,
} from "@grokdesk/shared/remote";
import type { StoredSession } from "../storage/session";
import {
  loadOfflineQueue,
  saveOfflineQueue,
} from "../storage/offline-queue";
import {
  isConnectionLevelRelayCode,
  isDeskRpcTimeoutError,
  KEY_SKEW_MESSAGE,
  timeoutStreakAction,
} from "./remote-timeout-policy";

export type WsLike = {
  send: (data: string) => void;
  close: () => void;
  addEventListener?: (
    type: string,
    fn: (ev: { data: unknown }) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    fn: (ev: { data: unknown }) => void,
  ) => void;
  on?: (type: string, fn: (data: unknown) => void) => void;
  off?: (type: string, fn: (data: unknown) => void) => void;
  readyState?: number;
};

export type CreateWs = (url: string) => WsLike | Promise<WsLike>;

export type ConnectionListener = (model: ConnectionModel) => void;
export type FatalSessionListener = (info: ClassifiedRemoteError) => void;
/** CX-2: sealed control events from desk (`t:"event"`). */
export type ControlEventListener = (ev: {
  channel: string;
  payload: unknown;
}) => void;

/** Normalize RN / browser / Node WebSocket payloads to UTF-8 text. */
export function wsDataToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data as ArrayBufferView);
  }
  // Node ws may pass Buffer
  if (
    data &&
    typeof data === "object" &&
    "toString" in data &&
    typeof (data as { toString: (enc?: string) => string }).toString ===
      "function"
  ) {
    try {
      return (data as { toString: (enc?: string) => string }).toString("utf8");
    } catch {
      return String(data);
    }
  }
  return String(data);
}

function onMessage(ws: WsLike, fn: (data: string) => void): () => void {
  if (ws.addEventListener) {
    const handler = (ev: { data: unknown }) => fn(wsDataToString(ev.data));
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener?.("message", handler);
  }
  if (ws.on) {
    const handler = (data: unknown) => fn(wsDataToString(data));
    ws.on("message", handler);
    return () => ws.off?.("message", handler);
  }
  throw new Error("WebSocket missing message API");
}

/** Default max wait for WebSocket open before rejecting (keeps reconnect unstuck). */
export const WS_OPEN_TIMEOUT_MS = 15_000;

/**
 * Wait until the socket is open. Rejects on error or timeout so callers never hang forever.
 * Exported for unit tests of the shipped path.
 */
export function waitOpen(
  ws: WsLike,
  timeoutMs: number = WS_OPEN_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === 1) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("ws open timeout")),
      timeoutMs,
    );

    if (ws.addEventListener) {
      ws.addEventListener("open" as never, () => finish());
      ws.addEventListener("error" as never, () =>
        finish(new Error("ws error")),
      );
      return;
    }
    if (ws.on) {
      ws.on("open", () => finish());
      ws.on("error", () => finish(new Error("ws error")));
      return;
    }
    // Node ws without events — brief settle, still bounded by timeout above
    setTimeout(() => finish(), Math.min(50, timeoutMs));
  });
}

/** Drop relay frames larger than this before JSON.parse (DoS guard). */
const MAX_RELAY_FRAME_CHARS = 400_000;

function onceJson(
  ws: WsLike,
  pred: (msg: Record<string, unknown>) => boolean,
  ms = 15_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error("timeout"));
    }, ms);
    const off = onMessage(ws, (data) => {
      try {
        if (typeof data !== "string" || data.length > MAX_RELAY_FRAME_CHARS) {
          return;
        }
        const msg = JSON.parse(data) as Record<string, unknown>;
        if (pred(msg)) {
          clearTimeout(t);
          off();
          resolve(msg);
        }
      } catch {
        /* ignore */
      }
    });
  });
}

/**
 * UUID v4 for RN + web. `crypto.randomUUID` is missing on many React Native
 * runtimes even after `react-native-get-random-values` (which only polyfills
 * getRandomValues).
 */
export function randomId(): string {
  const c = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array }
    | undefined;
  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function pairWithQr(
  qrString: string,
  opts: {
    deviceLabel: string;
    createWs: CreateWs;
    deviceId?: string;
    keyPair?: X25519KeyPair;
  },
): Promise<StoredSession> {
  const qr = decodePairingQr(qrString);
  let relay = qr.relay;
  if (!relay.includes("/v1")) {
    relay = relay.replace(/\/$/, "") + "/v1";
  }
  // 127.0.0.1 in a QR always means "this phone", not the desk — fail loudly.
  if (/^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(relay)) {
    throw new Error(
      "Pairing QR points at 127.0.0.1/localhost — that is this phone, not your desk. Use the default wss://grokdesk.app/relay, or set the Mac relay to ws://<mac-lan-ip>:8788 and show a new QR.",
    );
  }
  const kp = opts.keyPair ?? generateX25519KeyPair();
  const deviceId = opts.deviceId ?? randomId();
  const ws = await opts.createWs(relay);
  try {
    await waitOpen(ws);
    // onceJson ignores non-matching messages (e.g. "welcome") until hello_ok
    ws.send(
      JSON.stringify({
        type: "hello",
        role: "phone",
        machineId: qr.mid,
        deviceId,
        token: `pair-temp-${deviceId}`,
      }),
    );
    await onceJson(ws, (m) => m.type === "hello_ok");

    const pairKey = derivePairFrameKey(b64uDecode(qr.secret));
    const offer = {
      v: 1 as const,
      kind: "pair_offer" as const,
      deviceId,
      deviceLabel: opts.deviceLabel.slice(0, 64),
      devicePub: b64uEncode(kp.publicKey),
      pairSecret: qr.secret,
    };
    ws.send(
      JSON.stringify({
        type: "send",
        channel: `pair:${qr.mid}`,
        blob: b64uEncode(sealFrame(pairKey, serializeJson(offer))),
      }),
    );
    const acceptMsg = await onceJson(
      ws,
      (m) => m.type === "recv" && String(m.channel).startsWith("pair:"),
    );
    // CX-12: unsealed pair_fail marker (expired/reused QR) before openFrame.
    try {
      const rawBlob = b64uDecode(String(acceptMsg.blob));
      const asText = new TextDecoder().decode(rawBlob);
      if (asText.includes("pair_fail")) {
        const marker = JSON.parse(asText) as {
          kind?: string;
          reason?: string;
        };
        if (marker.kind === "pair_fail") {
          throw new Error(
            marker.reason === "expired"
              ? "Pairing code expired — refresh the QR on the desk and try again"
              : "Pairing rejected — show a new QR on the desk",
          );
        }
      }
    } catch (e) {
      if (
        e instanceof Error &&
        (/expired|rejected|Pairing/i.test(e.message))
      ) {
        throw e;
      }
      /* not a cleartext marker — continue with sealed accept */
    }
    const accept = PairAcceptPlainSchema.parse(
      parseJsonBytes(openFrame(pairKey, b64uDecode(String(acceptMsg.blob)))),
    );

    return {
      machineId: accept.machineId,
      machinePub: accept.machinePub,
      deviceId: accept.deviceId,
      deviceToken: accept.deviceToken,
      channel: accept.channel,
      relay,
      pairSecret: qr.secret,
      deviceSecretB64: b64uEncode(kp.secretKey),
      devicePubB64: b64uEncode(kp.publicKey),
      deviceLabel: opts.deviceLabel,
      pairedAt: Date.now(),
    };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

export class RemoteGatewayClient {
  private ws: WsLike | null = null;
  private frameKey: Uint8Array | null = null;
  /** Protocol dual-stack state (v1 or v2). When set, preferred over frameKey alone. */
  private sessionCrypto: SessionCryptoState | null = null;
  private deviceKeyPair: X25519KeyPair | null = null;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private off: (() => void) | null = null;
  private teleFrameListeners = new Set<(f: TeleFramePlain) => void>();
  private eventListeners = new Set<ControlEventListener>();
  private teleChannel: string;
  private conn: ConnectionModel = initialConnectionModel();
  private connListeners = new Set<ConnectionListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongWatchTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectEnabled = false;
  /** Shared in-flight connect so concurrent callers await the same attempt. */
  private connectInFlight: Promise<void> | null = null;
  private closedByUser = false;
  private flushing = false;
  private fatalListeners = new Set<FatalSessionListener>();
  private fatalFired = false;
  /**
   * Consecutive RPC timeouts without a successful response since the last
   * good reply. First timeout → force reconnect (non-fatal). Second timeout
   * after a proven-fresh transport → key skew → fatal (CX-1).
   */
  private consecutiveTimeoutsAfterFreshConnect = 0;

  constructor(
    private session: StoredSession,
    private createWs: CreateWs,
    /** Override waitOpen timeout (tests use short values; production default 15s). */
    private openTimeoutMs: number = WS_OPEN_TIMEOUT_MS,
    /** Override RPC timeout (tests use short values; production default 20s). */
    private requestTimeoutMs: number = 20_000,
  ) {
    this.teleChannel = teleChannel(session.machineId, session.deviceId);
  }

  /** Replace session material after rekey (before reconnect). */
  replaceSession(session: StoredSession) {
    this.session = session;
    this.teleChannel = teleChannel(session.machineId, session.deviceId);
    this.frameKey = null;
      this.sessionCrypto = null;
  }

  get connection(): ConnectionModel {
    return this.conn;
  }

  onConnectionChange(fn: ConnectionListener): () => void {
    this.connListeners.add(fn);
    fn(this.conn);
    return () => this.connListeners.delete(fn);
  }

  private setConn(event: Parameters<typeof reduceConnection>[1]) {
    this.conn = reduceConnection(this.conn, event);
    for (const l of this.connListeners) {
      try {
        l(this.conn);
      } catch {
        /* ignore */
      }
    }
  }

  onTeleFrame(fn: (f: TeleFramePlain) => void): () => void {
    this.teleFrameListeners.add(fn);
    return () => this.teleFrameListeners.delete(fn);
  }

  /** CX-2: desk-pushed sealed events (tasks/inbox/approvals). */
  onEvent(fn: ControlEventListener): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /**
   * Fired once when a control error means the local pairing is dead
   * (desk revoke / invalid token). App should wipe session and return to Pair.
   */
  onFatalSession(fn: FatalSessionListener): () => void {
    this.fatalListeners.add(fn);
    return () => this.fatalListeners.delete(fn);
  }

  private maybeFatal(err: unknown): ClassifiedRemoteError {
    const c = classifyRemoteError(err);
    if (c.fatalSession && !this.fatalFired) {
      this.fatalFired = true;
      this.reconnectEnabled = false;
      this.clearReconnectTimer();
      for (const l of this.fatalListeners) {
        try {
          l(c);
        } catch {
          /* ignore */
        }
      }
    }
    return c;
  }

  /**
   * Enable automatic reconnect with exponential backoff after unexpected drops.
   * Call after a successful connect when the session should stay live.
   */
  enableAutoReconnect(enabled = true) {
    this.reconnectEnabled = enabled;
    if (!enabled) this.clearReconnectTimer();
  }

  /**
   * Connect (or join the in-flight attempt). Concurrent callers share one Promise —
   * never resolve early as success while still connecting.
   * Not `async` so callers receive the same Promise identity (no wrapper).
   */
  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    if (this.connectInFlight) return this.connectInFlight;

    this.closedByUser = false;
    this.clearReconnectTimer();
    this.setConn({ type: "connect_start" });

    this.connectInFlight = this.doConnect().finally(() => {
      this.connectInFlight = null;
    });
    return this.connectInFlight;
  }

  private async doConnect(): Promise<void> {
    try {
      // Tear down any prior socket so reconnect does not leak listeners.
      this.closeSocketOnly({ rejectPending: true });
      const ws = await this.createWs(this.session.relay);
      // Track immediately so timeout/error paths close the socket (no leak).
      this.ws = ws;
      await waitOpen(ws, this.openTimeoutMs);
      ws.send(
        JSON.stringify({
          type: "hello",
          role: "phone",
          machineId: this.session.machineId,
          deviceId: this.session.deviceId,
          token: this.session.deviceToken,
        }),
      );
      await onceJson(ws, (m) => m.type === "hello_ok");
      const mySecret = b64uDecode(this.session.deviceSecretB64);
      const theirPublic = b64uDecode(this.session.machinePub);
      const pairSecret = b64uDecode(this.session.pairSecret);
      // Start at protocol 1 for hello (must decrypt on both sides before negotiate).
      this.sessionCrypto = createSessionCrypto({
        protocol: 1,
        mySecret,
        theirPublic,
        pairSecret,
        machineId: this.session.machineId,
        deviceId: this.session.deviceId,
      });
      this.frameKey = this.sessionCrypto.frameKey;
      this.off = onMessage(ws, (data) => this.onData(data));
      this.attachCloseHandlers(ws);
      // Flush offline queue BEFORE announcing Online so App resumeActiveTab
      // list fetches see post-flush state (no deleted-item reappearance).
      const flush = await this.flushPendingQueue();
      // Prove control keys work when the queue was empty (no RPC yet).
      // Broken ECDH previously looked "Online" while every call timed out
      // (desk logs "invalid tag").
      if (flush.flushed === 0 && !flush.error) {
        try {
          await this.request("tasks.list");
        } catch (healthErr) {
          const hmsg =
            healthErr instanceof Error
              ? healthErr.message
              : String(healthErr);
          // CX-1: a single connect-time timeout is not proof of key skew —
          // only consecutive timeouts after a fresh transport are fatal, and
          // request() already handles that counter. Bubble the real error.
          throw new Error(hmsg);
        }
      }
      this.setConn({ type: "connect_ok" });
      this.startHeartbeat();
      // Prefer protocol 2; desk negotiates and may stay on 1 for older builds.
      try {
        const hello: ControlPlain = {
          t: "hello",
          role: "phone",
          deviceId: this.session.deviceId,
          protocol: 2,
        };
        const sealedHello = this.sealControl(serializeControlPlain(hello));
        ws.send(
          JSON.stringify({
            type: "send",
            channel: this.session.channel,
            blob: b64uEncode(sealedHello),
          }),
        );
      } catch {
        /* non-fatal */
      }
      if (flush.error) {
        this.setConn({ type: "queue_flush_error", error: flush.error });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setConn({ type: "connect_fail", error: msg });
      // Closes this.ws (assigned before waitOpen) so abandoned sockets do not leak.
      this.closeSocketOnly({ rejectPending: true });
      this.frameKey = null;
      this.sessionCrypto = null;
      // Stale pairing material cannot be fixed by reconnect — force re-pair.
      // Bare timeouts are NOT fatal (CX-1); only true key-skew / revoke strings.
      if (
        /out of sync|invalid tag|Device revoked|keys invalid|not active|unknown device|invalid token/i.test(
          msg,
        )
      ) {
        this.maybeFatal(new Error(msg));
        this.setConn({ type: "give_up" });
        throw e instanceof Error ? e : new Error(msg);
      }
      if (this.reconnectEnabled && !this.closedByUser) {
        this.scheduleReconnect();
      } else {
        this.setConn({ type: "give_up" });
      }
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  private attachCloseHandlers(ws: WsLike) {
    const onClose = () => {
      if (this.ws !== ws) return;
      this.closeSocketOnly({ rejectPending: true });
      this.frameKey = null;
      this.sessionCrypto = null;
      if (this.closedByUser) {
        this.setConn({ type: "manual_offline" });
        return;
      }
      this.setConn({ type: "disconnect" });
      if (this.reconnectEnabled) this.scheduleReconnect();
    };
    if (ws.addEventListener) {
      ws.addEventListener("close" as never, onClose as never);
      return;
    }
    if (ws.on) {
      ws.on("close", onClose);
    }
  }

  private scheduleReconnect() {
    if (!shouldKeepReconnecting(this.conn.attempt)) {
      this.setConn({ type: "give_up" });
      return;
    }
    this.clearReconnectTimer();
    const delay = nextBackoffMs(this.conn.attempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        /* connect already schedules next or give_up */
      });
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocketOnly(opts?: { rejectPending?: boolean }) {
    this.stopHeartbeat();
    try {
      this.off?.();
    } catch {
      /* ignore */
    }
    this.off = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    if (opts?.rejectPending !== false) {
      for (const [, p] of this.pending) {
        p.reject(new Error("connection closed"));
      }
      this.pending.clear();
    }
  }

  /** CX-8: ping the relay every ~20s; miss a pong → close + reconnect. */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      try {
        this.ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        this.frameKey = null;
      this.sessionCrypto = null;
        this.closeSocketOnly({ rejectPending: true });
        if (this.reconnectEnabled && !this.closedByUser) {
          this.setConn({ type: "disconnect" });
          this.scheduleReconnect();
        }
        return;
      }
      if (this.pongWatchTimer) clearTimeout(this.pongWatchTimer);
      this.pongWatchTimer = setTimeout(() => {
        // Missed pong — half-open socket
        this.frameKey = null;
      this.sessionCrypto = null;
        this.closeSocketOnly({ rejectPending: true });
        if (this.reconnectEnabled && !this.closedByUser) {
          this.setConn({ type: "disconnect" });
          this.scheduleReconnect();
        }
      }, 10_000);
    }, 20_000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongWatchTimer) {
      clearTimeout(this.pongWatchTimer);
      this.pongWatchTimer = null;
    }
  }


  private sealControl(plain: Uint8Array): Uint8Array {
    if (this.sessionCrypto) {
      const { sealed, state } = sealControlOutbound(
        this.sessionCrypto,
        plain,
        "c2s",
      );
      this.sessionCrypto = state;
      this.frameKey = state.frameKey;
      return sealed;
    }
    if (!this.frameKey) throw new Error("no frame key");
    return sealFrame(this.frameKey, plain);
  }

  private openControl(blob: Uint8Array): Uint8Array | null {
    if (this.sessionCrypto) {
      const result = openControlInbound(this.sessionCrypto, blob, "s2c");
      if (!result.ok) return null;
      this.sessionCrypto = result.state;
      this.frameKey = result.state.frameKey;
      return result.plain;
    }
    if (!this.frameKey) return null;
    try {
      return openFrame(this.frameKey, blob);
    } catch {
      return null;
    }
  }

  /** Upgrade to protocol 2 after desk hello ack (same ECDH material). */
  private maybeUpgradeProtocol(payload: unknown): void {
    if (!this.session || !this.sessionCrypto) return;
    const p = payload as { protocol?: number; ok?: boolean; maxProtocol?: number };
    if (!p?.ok) return;
    const negotiated = p.protocol === 2 ? 2 : 1;
    if (negotiated !== 2 || this.sessionCrypto.protocol === 2) return;
    try {
      this.sessionCrypto = createSessionCrypto({
        protocol: 2,
        mySecret: b64uDecode(this.session.deviceSecretB64),
        theirPublic: b64uDecode(this.session.machinePub),
        pairSecret: b64uDecode(this.session.pairSecret),
        machineId: this.session.machineId,
        deviceId: this.session.deviceId,
      });
      this.frameKey = this.sessionCrypto.frameKey;
    } catch {
      /* stay on v1 */
    }
  }

  private onData(data: string) {
    if (typeof data !== "string" || data.length > MAX_RELAY_FRAME_CHARS) {
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    // CX-8: clear pong watch on any relay pong
    if (msg.type === "pong") {
      if (this.pongWatchTimer) {
        clearTimeout(this.pongWatchTimer);
        this.pongWatchTimer = null;
      }
      return;
    }
    // Relay-level errors (desk offline, channel forbidden, etc.)
    // CX-7: only connection-level codes nuke the session; correlated / one-off
    // errors (blob_too_large, etc.) must not reject every pending RPC.
    if (msg.type === "err") {
      const code = String(msg.code ?? "");
      const err = new Error(
        String(msg.message ?? msg.code ?? "relay error"),
      );
      const connectionLevel = isConnectionLevelRelayCode(code);
      const correlatedId =
        msg.id != null && String(msg.id).length > 0 ? String(msg.id) : null;
      if (correlatedId && this.pending.has(correlatedId)) {
        this.pending.get(correlatedId)!.reject(err);
        this.pending.delete(correlatedId);
        return;
      }
      if (connectionLevel) {
        for (const [, p] of this.pending) {
          p.reject(err);
        }
        this.pending.clear();
        this.setConn({
          type: "connect_fail",
          error: err.message,
        });
        return;
      }
      // Uncorrelated non-connection error (e.g. blob_too_large): drop on floor
      // so a single bad send cannot flash "Reconnecting…" for everyone.
      return;
    }
    if (msg.type !== "recv" || !this.frameKey) return;
    const channel = String(msg.channel);
    try {
      if (channel === this.teleChannel) {
        const opened = parseJsonBytes(
          openFrame(this.frameKey, b64uDecode(String(msg.blob))),
        ) as TeleFramePlain;
        if (opened?.kind === "frame") {
          for (const l of this.teleFrameListeners) {
            try {
              l(opened);
            } catch {
              /* ignore */
            }
          }
        }
        return;
      }
      if (channel !== this.session.channel) return;
      const opened = this.openControl(b64uDecode(String(msg.blob)));
      if (!opened) return;
      const plain = parseControlPlain(opened);
      // CX-2: sealed desk events
      if (plain.t === "event") {
        if (plain.channel === "protocol.hello") {
          this.maybeUpgradeProtocol(plain.payload);
        }
        for (const l of this.eventListeners) {
          try {
            l({ channel: plain.channel, payload: plain.payload });
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (plain.t !== "res") return;
      const p = this.pending.get(plain.id);
      if (!p) return;
      this.pending.delete(plain.id);
      if (plain.ok) p.resolve(plain.result);
      else p.reject(new Error(plain.error));
    } catch {
      /* ignore */
    }
  }

  /** Wire is up (may still be flushing queue before UI "online"). */
  private get socketLive(): boolean {
    return (
      this.ws != null && this.frameKey != null && this.ws.readyState === 1
    );
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    // One reconnect attempt if the socket looks half-open (common on mobile).
    // Use socketLive (not isConnected) so queue flush during connect can RPC.
    if (!this.socketLive && !this.connectInFlight) {
      try {
        await this.connect();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Not connected to desk — ${msg}`);
      }
    }
    if (!this.socketLive) {
      const e = new Error("not connected");
      this.maybeFatal(e);
      throw e;
    }
    const ws = this.ws!;
    if (!this.frameKey && !this.sessionCrypto) {
      throw new Error("not connected");
    }
    const id = `m-${Math.random().toString(36).slice(2, 10)}`;
    const plain: ControlPlain = { t: "req", id, method, params };
    const sealed = this.sealControl(serializeControlPlain(plain));
    if (new TextDecoder().decode(sealed).includes(method)) {
      throw new Error("ciphertext leaked method");
    }
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => {
          // Successful response resets the timeout streak (CX-1).
          this.consecutiveTimeoutsAfterFreshConnect = 0;
          resolve(v);
        },
        reject,
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(
            new Error(
              `timeout ${method} — desk did not answer. Check same Wi‑Fi and that Remote is Connected on the Mac.`,
            ),
          );
        }
      }, this.requestTimeoutMs);
    });
    try {
      ws.send(
        JSON.stringify({
          type: "send",
          channel: this.session.channel,
          blob: b64uEncode(sealed),
        }),
      );
    } catch (e) {
      this.pending.delete(id);
      this.frameKey = null;
      this.sessionCrypto = null;
      this.closeSocketOnly({ rejectPending: false });
      throw new Error(
        `send failed for ${method}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    try {
      return await result;
    } catch (err) {
      const emsg = err instanceof Error ? err.message : String(err);
      if (isDeskRpcTimeoutError(emsg)) {
        const action = timeoutStreakAction(
          this.consecutiveTimeoutsAfterFreshConnect,
        );
        this.consecutiveTimeoutsAfterFreshConnect = action.nextStreak;
        // First timeout on this transport: force socket close so the next
        // request/connect uses a proven-fresh hello (CX-1). Not fatal.
        if (action.type === "reconnect") {
          this.frameKey = null;
          this.sessionCrypto = null;
          this.closeSocketOnly({ rejectPending: true });
          if (this.reconnectEnabled && !this.closedByUser) {
            this.setConn({ type: "disconnect" });
            this.scheduleReconnect();
          } else {
            this.setConn({ type: "connect_fail", error: emsg });
          }
          const c = classifyRemoteError(err);
          throw new Error(`${remoteErrorLabel(c.kind)}: ${c.message}`);
        }
        // Second consecutive timeout after a fresh transport → key skew.
        const skew = new Error(KEY_SKEW_MESSAGE);
        this.maybeFatal(skew);
        throw new Error(
          `${remoteErrorLabel("revoked")}: ${skew.message}`,
        );
      }
      const c = this.maybeFatal(err);
      // Re-throw with clearer label when useful
      if (c.kind !== "unknown") {
        throw new Error(`${remoteErrorLabel(c.kind)}: ${c.message}`);
      }
      throw err;
    }
  }

  /**
   * Online: send immediately.
   * Offline + queueable: durable enqueue (does not pretend success for telepresence).
   * Offline + non-queueable: throw clear error.
   */
  async requestOrQueue(
    method: string,
    params: unknown = {},
  ): Promise<{ queued: boolean; result?: unknown }> {
    if (this.socketLive || this.isConnected) {
      const result = await this.request(method, params);
      return { queued: false, result };
    }
    if (!isOfflineQueueableMethod(method)) {
      throw new Error(
        `Offline — cannot call ${method}. Reconnect when the desk is reachable.`,
      );
    }
    const items = await loadOfflineQueue();
    const next: OfflineQueueItem[] = [
      ...items,
      {
        id: `q-${Math.random().toString(36).slice(2, 12)}`,
        method,
        params,
        createdAt: Date.now(),
      },
    ];
    await saveOfflineQueue(next);
    // CX-10: do not strand items until the next full disconnect cycle.
    // If a connect is in flight (or already live), flush as soon as possible.
    const flushSoon = async () => {
      try {
        if (this.connectInFlight) await this.connectInFlight;
        if (this.socketLive) await this.flushPendingQueue();
      } catch {
        /* flush errors surface via connection model */
      }
    };
    void flushSoon();
    return { queued: true };
  }

  /** Flush durable offline queue over live control channel (FIFO). */
  async flushPendingQueue(): Promise<{
    flushed: number;
    remaining: number;
    error?: string;
  }> {
    // socketLive: allow flush during doConnect before UI state flips to online
    if (!this.socketLive || this.flushing) {
      return { flushed: 0, remaining: (await loadOfflineQueue()).length };
    }
    this.flushing = true;
    try {
      const items = await loadOfflineQueue();
      if (items.length === 0) return { flushed: 0, remaining: 0 };
      const result = await flushOfflineQueue(
        items,
        // CX-5: transmit stable client id for desk-side idempotency.
        // Extra field is ignored by Zod-parsed methods that strip unknown keys.
        (method, params, clientId) =>
          this.request(method, {
            ...(params && typeof params === "object"
              ? (params as Record<string, unknown>)
              : { value: params }),
            clientMutationId: clientId,
          }),
      );
      await saveOfflineQueue(result.remaining);
      return {
        flushed: result.flushed.length,
        remaining: result.remaining.length,
        error: result.error,
      };
    } finally {
      this.flushing = false;
    }
  }

  async startTelepresence(
    quality: TelepresenceQuality = "auto",
    displayId?: string | null,
  ) {
    return this.request("remote.telepresence.start", {
      deviceId: this.session.deviceId,
      quality,
      displayId: displayId ?? undefined,
    });
  }

  async stopTelepresence() {
    return this.request("remote.telepresence.stop", {
      deviceId: this.session.deviceId,
    });
  }

  async setTeleQuality(quality: TelepresenceQuality) {
    return this.request("remote.telepresence.setQuality", { quality });
  }

  async listDisplays() {
    return this.request("remote.telepresence.listDisplays", {});
  }

  async teleInput(params: Record<string, unknown>) {
    return this.request("remote.telepresence.input", params);
  }

  /**
   * CX-14: rotate device ECDH keys over the live channel, persist new secrets.
   * Caller must save the returned session and rebuild the client.
   */
  async rekey(): Promise<StoredSession> {
    const kp = generateX25519KeyPair();
    const devicePub = b64uEncode(kp.publicKey);
    await this.request("remote.rekey", {
      deviceId: this.session.deviceId,
      devicePub,
    });
    const next: StoredSession = {
      ...this.session,
      deviceSecretB64: b64uEncode(kp.secretKey),
      devicePubB64: devicePub,
      lastRekeyAt: Date.now(),
    };
    this.session = next;
    // Force next request path to reconnect with new frame key.
    this.frameKey = null;
      this.sessionCrypto = null;
    this.closeSocketOnly({ rejectPending: true });
    return next;
  }

  /** Expose current session snapshot (after rekey etc.). */
  getSession(): StoredSession {
    return this.session;
  }

  close() {
    this.closedByUser = true;
    this.reconnectEnabled = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.connectInFlight = null;
    this.closeSocketOnly({ rejectPending: true });
    this.teleFrameListeners.clear();
    this.eventListeners.clear();
    this.frameKey = null;
      this.sessionCrypto = null;
    this.setConn({ type: "manual_offline" });
  }

  get isConnected(): boolean {
    // UI + ensureClient: require live OPEN socket with session keys.
    // conn.state may still be "reconnecting" during queue flush; socketLive
    // is enough for RPCs, but product "Online" uses connection model.
    return this.socketLive;
  }
}
