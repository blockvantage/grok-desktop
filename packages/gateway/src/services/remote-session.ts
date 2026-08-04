/**
 * Desk-side remote session inside the gateway process.
 * Connects to the blind relay, accepts pairs, proxies allowlisted IPC.
 */
import WebSocket from "ws";
import type { Gateway } from "../index.js";
import {
  b64uDecode,
  b64uEncode,
  DEFAULT_RELAY_URL,
  derivePairFrameKey,
  openFrame,
  parseControlPlain,
  parseJsonBytes,
  PairOfferPlainSchema,
  redactSecretString,
  sealFrame,
  serializeControlPlain,
  serializeJson,
  teleChannel,
  createSessionCrypto,
  negotiateProtocol,
  openControlInbound,
  sealControlOutbound,
  type ControlPlain,
  type TeleFramePlain,
  type SessionCryptoState,
  type NegotiatedProtocol,
} from "@grokdesk/shared";
import { RemoteApplicationService } from "./remote-application.js";
import { isTeleFrameBlobSendable } from "./tele-frame-limits.js";
import { pairFailMarkerBytes } from "./pair-fail-marker.js";
import type { EntitlementGuard } from "./entitlement-guard.js";

function redactRemoteLogError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const redacted = redactSecretString(raw);
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

type DeviceSession = {
  deviceId: string;
  /** @deprecated prefer crypto.frameKey — kept for quick access */
  frameKey: Uint8Array;
  crypto: SessionCryptoState;
};

/** Soft cap on cached E2E device sessions (product seats are much lower). */
const MAX_DEVICE_SESSIONS = 32;

export class RemoteSessionHost {
  private ws: WebSocket | null = null;
  private stopped = true;
  private sessions = new Map<string, DeviceSession>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private helloOk = false;
  private readonly app: RemoteApplicationService;

  constructor(private gateway: Gateway) {
    this.app = new RemoteApplicationService(gateway);
  }

  /** Inject or clear entitlement guard on the remote application service. */
  setEntitlementGuard(guard: EntitlementGuard | null): void {
    this.app.setEntitlementGuard(guard);
  }

  /** True after desk has completed relay hello (for tests / readiness). */
  isRelayReady(): boolean {
    return (
      !this.stopped &&
      this.helloOk &&
      this.ws != null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  /**
   * Disconnect from relay. By default keeps telepresence running so a brief
   * WS refresh does not yank remote control mid-stream.
   */
  async stop(opts?: { stopTelepresence?: boolean }): Promise<void> {
    this.stopped = true;
    this.helloOk = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (opts?.stopTelepresence) {
      try {
        await this.gateway.telepresence?.stop();
      } catch {
        /* ignore */
      }
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  /**
   * Push a sealed telepresence media frame to the phone (E2E, not plaintext on relay).
   * Returns false when the frame was not enqueued (caller records a drop).
   */
  pushTeleFrame(deviceId: string, frame: TeleFramePlain): boolean {
    const sess = this.resolveSession(deviceId);
    if (!sess || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (!this.gateway.remote.isDeviceActive(deviceId)) return false;
    const st = this.gateway.remote.status();
    const channel = teleChannel(st.machineId, deviceId);
    const sealed = sealFrame(
      sess.frameKey,
      serializeJson(frame),
    );
    // Relay rejects oversized blobs (~350k); skip fat frames rather than error-storm.
    if (!isTeleFrameBlobSendable(b64uEncode(sealed).length)) return false;
    this.send(channel, sealed);
    return true;
  }

  /**
   * CX-12: unsealed pair_fail on the pair channel + desktop toast via notify.
   * Contains no secrets — only a machine-readable reason code.
   */
  private emitPairFail(
    channel: string,
    reason: "expired" | "invalid" | "unknown",
  ): void {
    try {
      this.gateway.emitNotify("notify.pairAttemptFailed", { reason });
    } catch {
      /* ignore */
    }
    try {
      // Unsealed cleartext marker (not E2E) — phone detects before openFrame.
      const marker = b64uEncode(pairFailMarkerBytes(reason));
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "send",
            channel,
            blob: marker,
          }),
        );
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * CX-2: push a sealed control `t:"event"` frame to every active paired device.
   * Old phones drop non-`res` frames — additive and backward-safe.
   */
  broadcastNotify(method: string, params: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const st = this.gateway.remote.status();
    if (!st.enabled) return;
    const devices = this.gateway.remote
      .listDevices()
      .filter((d) => !d.revokedAt);
    for (const d of devices) {
      this.pushControlEvent(d.id, method, params);
    }
  }

  /** Sealed notify event on a single device control channel. */
  pushControlEvent(
    deviceId: string,
    eventChannel: string,
    payload: unknown,
  ): void {
    const sess = this.resolveSession(deviceId);
    if (!sess || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.gateway.remote.isDeviceActive(deviceId)) return;
    const st = this.gateway.remote.status();
    const channel = `ctrl:${st.machineId}:${deviceId}`;
    const plain: ControlPlain = {
      t: "event",
      channel: eventChannel,
      payload,
    };
    try {
      this.send(channel, this.sealToDevice(sess, serializeControlPlain(plain)));
    } catch {
      /* never break desk work on push failure */
    }
  }

  /** Reconnect WS when remote is enabled. Preserves telepresence session. */
  async refresh(): Promise<void> {
    await this.stop({ stopTelepresence: false });
    const st = this.gateway.remote.status();
    if (st.enabled) {
      this.stopped = false;
      await this.connect();
    }
  }

  private scheduleReconnect(ms: number) {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(), ms);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const st = this.gateway.remote.status();
    if (!st.enabled) {
      this.scheduleReconnect(5000);
      return;
    }
    const token = this.gateway.remote.getDeskToken();
    if (!token) {
      this.scheduleReconnect(5000);
      return;
    }
    let url = st.relayUrl || DEFAULT_RELAY_URL;
    if (!url.includes("/v1")) {
      url = url.replace(/\/$/, "") + "/v1";
    }

    try {
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          /* ignore */
        }
      }
      this.helloOk = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("desk relay connect timeout")), 10_000);
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "hello",
              role: "desk",
              machineId: st.machineId,
              token,
            }),
          );
        });
        ws.on("message", (data) => {
          const raw = String(data);
          try {
            const msg = JSON.parse(raw) as { type?: string };
            if (msg.type === "hello_ok") {
              this.helloOk = true;
              clearTimeout(t);
              resolve();
            }
          } catch {
            /* ignore */
          }
          void this.onMessage(raw);
        });
        ws.on("close", () => {
          if (this.ws === ws) this.ws = null;
          this.helloOk = false;
          clearTimeout(t);
          this.scheduleReconnect(2000);
        });
        ws.on("error", (err) => {
          clearTimeout(t);
          reject(err);
        });
      }).catch(() => {
        this.scheduleReconnect(3000);
      });
    } catch {
      this.scheduleReconnect(3000);
    }
  }

  private send(channel: string, blob: Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "remote_send_skip",
          channel,
          reason: !this.ws ? "no_ws" : `readyState=${this.ws.readyState}`,
        }),
      );
      // Force reconnect so the next phone request is not black-holed.
      if (!this.stopped) this.scheduleReconnect(500);
      return;
    }
    this.ws.send(
      JSON.stringify({
        type: "send",
        channel,
        blob: b64uEncode(blob),
      }),
    );
  }

  /** Drop cached E2E keys for a device (after revoke). */
  forgetDevice(deviceId: string): void {
    this.sessions.delete(deviceId);
  }

  private resolveSession(
    deviceId: string,
    opts?: { bypassCache?: boolean; protocol?: NegotiatedProtocol },
  ): DeviceSession | null {
    // Prefer cache so we can still decrypt one last "Device revoked" after material wipe.
    if (!opts?.bypassCache) {
      const cached = this.sessions.get(deviceId);
      if (cached) return cached;
    }
    if (!this.gateway.remote.isDeviceActive(deviceId)) return null;
    const mat = this.gateway.remote.getDeviceSessionMaterial(deviceId);
    if (!mat) return null;
    const machineKp = this.gateway.remote.getMachineKeyPair();
    const machineId = this.gateway.remote.status().machineId;
    const protocol = opts?.protocol ?? 1;
    const crypto = createSessionCrypto({
      protocol,
      mySecret: machineKp.secretKey,
      theirPublic: b64uDecode(mat.publicKey),
      pairSecret: b64uDecode(mat.pairSecretB64),
      machineId,
      deviceId,
    });
    const sess: DeviceSession = {
      deviceId,
      frameKey: crypto.frameKey,
      crypto,
    };
    this.cacheSession(deviceId, sess);
    return sess;
  }

  private cacheSession(deviceId: string, sess: DeviceSession): void {
    if (!this.sessions.has(deviceId)) {
      while (this.sessions.size >= MAX_DEVICE_SESSIONS) {
        const oldest = this.sessions.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.sessions.delete(oldest);
      }
    } else {
      this.sessions.delete(deviceId);
    }
    this.sessions.set(deviceId, sess);
  }

  /** Upgrade an existing session to negotiated protocol after hello. */
  private upgradeSessionProtocol(
    deviceId: string,
    protocol: NegotiatedProtocol,
  ): DeviceSession | null {
    // Rebuild crypto for the negotiated protocol (same ECDH material).
    this.sessions.delete(deviceId);
    return this.resolveSession(deviceId, { bypassCache: true, protocol });
  }

  private sealToDevice(
    sess: DeviceSession,
    plain: Uint8Array,
  ): Uint8Array {
    const { sealed, state } = sealControlOutbound(sess.crypto, plain, "s2c");
    sess.crypto = state;
    sess.frameKey = state.frameKey;
    this.cacheSession(sess.deviceId, sess);
    return sealed;
  }

  private openFromDevice(
    sess: DeviceSession,
    blob: Uint8Array,
  ): { plain: Uint8Array; sess: DeviceSession } | null {
    const result = openControlInbound(sess.crypto, blob, "c2s");
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "remote_ctrl_open_fail",
          deviceId: sess.deviceId,
          reason: result.reason,
          protocol: sess.crypto.protocol,
        }),
      );
      return null;
    }
    sess.crypto = result.state;
    sess.frameKey = result.state.frameKey;
    this.cacheSession(sess.deviceId, sess);
    return { plain: result.plain, sess };
  }

  private async onMessage(raw: string) {
    try {
      await this.onMessageInner(raw);
    } catch {
      // Teardown races (closed DB / dead socket) must never crash the process.
    }
  }

  private async onMessageInner(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type !== "recv") return;
    const channel = String(msg.channel ?? "");
    let blob: Uint8Array;
    try {
      blob = b64uDecode(String(msg.blob ?? ""));
    } catch {
      return;
    }

    if (channel.startsWith("pair:")) {
      const offerRaw = this.gateway.remote.tryOpenPairBlob(
        blob,
        openFrame,
        derivePairFrameKey,
      );
      // CX-12: expired/reused QR — notify desk UI + unsealed pair_fail marker (no secrets).
      if (!offerRaw) {
        this.emitPairFail(channel, "expired");
        return;
      }
      try {
        const offer = PairOfferPlainSchema.parse(parseJsonBytes(offerRaw));
        // Wipe any cached frame key before accept so re-pair never reuses stale ECDH.
        this.sessions.delete(offer.deviceId);
        const accept = this.gateway.remote.acceptPairOffer(offer);
        this.resolveSession(offer.deviceId, { bypassCache: true });
        const sealed = sealFrame(
          derivePairFrameKey(b64uDecode(offer.pairSecret)),
          serializeJson(accept),
        );
        this.send(channel, sealed);
      } catch {
        this.emitPairFail(channel, "invalid");
      }
      return;
    }

    if (channel.startsWith("ctrl:")) {
      const deviceId = channel.split(":")[2];
      if (!deviceId) return;
      let sess = this.resolveSession(deviceId);
      if (!sess) {
        // eslint-disable-next-line no-console
        console.warn(
          JSON.stringify({
            event: "remote_ctrl_no_session",
            deviceId,
          }),
        );
        return;
      }
      // Open with negotiated protocol codec (v1 frameKey or v2 AAD+replay).
      let opened = this.openFromDevice(sess, blob);
      if (!opened) {
        // Stale frame-key cache after re-pair / key rotation — rebuild once at v1.
        this.sessions.delete(deviceId);
        sess = this.resolveSession(deviceId, { bypassCache: true, protocol: 1 });
        if (!sess) return;
        opened = this.openFromDevice(sess, blob);
        if (!opened) return;
      }
      sess = opened.sess;
      let plain: ControlPlain;
      try {
        plain = parseControlPlain(opened.plain);
      } catch {
        return;
      }
      // Protocol negotiation: phone hello may request 1 or 2; desk upgrades session.
      if (plain.t === "hello") {
        const negotiated = negotiateProtocol(plain.protocol);
        const ok = negotiated != null;
        if (ok && negotiated === 2 && sess.crypto.protocol !== 2) {
          const upgraded = this.upgradeSessionProtocol(deviceId, 2);
          if (upgraded) sess = upgraded;
        }
        try {
          this.send(
            channel,
            this.sealToDevice(
              sess,
              serializeControlPlain({
                t: "event",
                channel: "protocol.hello",
                payload: {
                  protocol: negotiated ?? 1,
                  role: "desk",
                  ok,
                  maxProtocol: 2,
                },
              }),
            ),
          );
        } catch {
          /* ignore */
        }
        return;
      }

      if (plain.t !== "req") return;

      const activeSess = sess;
      const reply = (res: ControlPlain) => {
        try {
          // Re-fetch session so outSeq advances across concurrent replies.
          const live =
            this.sessions.get(deviceId) ?? activeSess;
          this.send(
            channel,
            this.sealToDevice(live, serializeControlPlain(res)),
          );
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(
            JSON.stringify({
              event: "remote_ctrl_reply_fail",
              deviceId,
              error: redactRemoteLogError(e),
            }),
          );
        }
      };

      if (!this.gateway.remote.isDeviceActive(deviceId)) {
        this.sessions.delete(deviceId);
        reply({
          t: "res",
          id: plain.id,
          ok: false,
          error: "Device revoked",
        });
        return;
      }

      // Application layer (principal-bound) separated from transport framing.
      const appRes = await this.app.handle(plain.method, plain.params ?? {}, {
        deviceId,
        machineId: this.gateway.remote.status().machineId,
        requestId: plain.id,
      });
      if (appRes.ok) {
        reply({
          t: "res",
          id: plain.id,
          ok: true,
          result: appRes.result,
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          JSON.stringify({
            event: "remote_ctrl_handle_fail",
            deviceId,
            method: plain.method,
            error: redactSecretString(appRes.error).slice(0, 500),
          }),
        );
        reply({
          t: "res",
          id: plain.id,
          ok: false,
          error: appRes.error,
        });
      }
    }
  }
}
