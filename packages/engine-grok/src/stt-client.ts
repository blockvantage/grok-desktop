/**
 * Grok STT client (SuperGrok / xAI).
 *
 * Live endpoint (verified 2026-07-11):
 *   POST https://api.x.ai/v1/stt
 *   Authorization: Bearer <SuperGrok access token>
 *   multipart/form-data with field `file` (WAV works; webm rejected)
 *
 * Streaming WebSocket exists at the same path (requires Upgrade: websocket)
 * but multipart WAV is the stable Desk path for dictation stop → text.
 */

export type SttServerEvent =
  | { type: "created" }
  | { type: "partial"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export interface SttTransport {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onOpen(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
  onClose(cb: () => void): void;
}

export const DEFAULT_STT_URL = "https://api.x.ai/v1/stt";

/** Wall-clock timeout for the STT multipart upload. */
export const DEFAULT_STT_TIMEOUT_MS = 30_000;

export function defaultSttUrl(): string {
  return process.env.GROKDESK_STT_URL?.trim() || DEFAULT_STT_URL;
}

/** Encode mono PCM s16le into a WAV container. */
export function encodeWavPcm16(
  pcm: Int16Array,
  sampleRate: number,
): Uint8Array {
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // pcm chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  return new Uint8Array(buffer);
}

/** Concatenate Int16 PCM chunks. */
export function concatPcm16(chunks: Int16Array[]): Int16Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Int16Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function parseSttServerMessage(raw: string): SttServerEvent | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const type = String(obj.type ?? obj.event ?? "").toLowerCase();
    if (type === "created" || type === "session.created") {
      return { type: "created" };
    }
    if (
      type === "partial" ||
      type === "transcript.partial" ||
      type === "input_audio_transcription.delta"
    ) {
      const text = String(obj.text ?? obj.delta ?? obj.transcript ?? "");
      return { type: "partial", text };
    }
    if (
      type === "done" ||
      type === "final" ||
      type === "transcript.done" ||
      type === "input_audio_transcription.completed"
    ) {
      const text = String(
        obj.text ?? obj.transcript ?? obj.result ?? obj.delta ?? "",
      );
      return { type: "done", text };
    }
    if (type === "error") {
      return {
        type: "error",
        message: String(obj.message ?? obj.error ?? "STT error"),
      };
    }
    // Batch HTTP JSON: { text, language, duration }
    if (typeof obj.text === "string" && !type) {
      return { type: "done", text: obj.text };
    }
    return null;
  } catch {
    return null;
  }
}

export interface TranscribeResult {
  text: string;
  language: string | null;
  duration: number | null;
  rawAvailable: boolean;
  error?: string;
}

export type SttFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: Uint8Array | Buffer;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Transcribe a WAV (or other supported container) via Grok STT multipart API.
 * Never logs the token.
 */
export async function transcribeAudioFile(opts: {
  accessToken: string;
  fileBytes: Uint8Array;
  filename?: string;
  contentType?: string;
  language?: string;
  url?: string;
  fetchImpl?: SttFetch;
  /** Wall-clock timeout for the upload. Default {@link DEFAULT_STT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Optional caller abort. Composed with the wall-clock timeout — never
   * replaces a caller signal; both can abort the request.
   */
  signal?: AbortSignal;
}): Promise<TranscribeResult> {
  if (!opts.accessToken) {
    return {
      text: "",
      language: null,
      duration: null,
      rawAvailable: false,
      error: "no_token",
    };
  }
  const boundary = `----GrokDesk${Date.now().toString(16)}`;
  const filename = opts.filename ?? "speech.wav";
  const contentType = opts.contentType ?? "audio/wav";
  const language = opts.language ?? "en";

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const push = (s: string | Uint8Array) => {
    chunks.push(typeof s === "string" ? enc.encode(s) : s);
  };
  push(`--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`);
  push(`--${boundary}\r\n`);
  push(
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  push(opts.fileBytes);
  push(`\r\n--${boundary}--\r\n`);

  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const body = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    body.set(c, o);
    o += c.byteLength;
  }

  const url = opts.url ?? defaultSttUrl();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STT_TIMEOUT_MS;
  const controller = new AbortController();
  const onCallerAbort = (): void => {
    controller.abort();
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      return {
        text: "",
        language: null,
        duration: null,
        rawAvailable: false,
        error: "network",
      };
    }
    opts.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const wallTimer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const fetchImpl =
    opts.fetchImpl ??
    (async (u, init) => {
      const res = await fetch(u, {
        method: init.method,
        headers: init.headers,
        body: init.body as BodyInit,
        signal: init.signal,
      });
      return {
        ok: res.ok,
        status: res.status,
        text: () => res.text(),
      };
    });

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        Accept: "application/json",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-grok-client-version": "0.2.93",
      },
      body,
      signal: controller.signal,
    });
    const rawText = await res.text();
    if (!res.ok) {
      return {
        text: "",
        language: null,
        duration: null,
        rawAvailable: false,
        error: `http_${res.status}`,
      };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return {
        text: "",
        language: null,
        duration: null,
        rawAvailable: false,
        error: "bad_json",
      };
    }
    const text = String(parsed.text ?? "").trim();
    const lang =
      typeof parsed.language === "string" && parsed.language
        ? parsed.language
        : null;
    const duration =
      typeof parsed.duration === "number" ? parsed.duration : null;
    return { text, language: lang, duration, rawAvailable: true };
  } catch {
    // Timeout, caller abort, and transport failures share the existing
    // network error shape so dictation-service maps to sttFailed.
    return {
      text: "",
      language: null,
      duration: null,
      rawAvailable: false,
      error: "network",
    };
  } finally {
    clearTimeout(wallTimer);
    if (opts.signal) {
      opts.signal.removeEventListener("abort", onCallerAbort);
    }
  }
}

export interface DictationSession {
  start(opts?: { language?: string }): Promise<void>;
  pushPcm(chunk: Uint8Array): void;
  stop(): Promise<string>;
  onPartial(cb: (text: string) => void): void;
  onError(cb: (err: Error) => void): void;
}

/** Session over an abstract transport (tests / future WS). */
export function createDictationSession(transport: SttTransport): DictationSession {
  let partialCbs: Array<(t: string) => void> = [];
  let errorCbs: Array<(e: Error) => void> = [];
  let finalText = "";
  let opened = false;
  let resolveOpen: (() => void) | null = null;
  let resolveStop: ((text: string) => void) | null = null;

  transport.onOpen(() => {
    opened = true;
    resolveOpen?.();
    resolveOpen = null;
  });
  transport.onError((err) => {
    for (const cb of errorCbs) cb(err);
  });
  transport.onMessage((data) => {
    const ev = parseSttServerMessage(data);
    if (!ev) return;
    if (ev.type === "partial") {
      finalText = ev.text || finalText;
      for (const cb of partialCbs) cb(ev.text);
    } else if (ev.type === "done") {
      finalText = ev.text || finalText;
      for (const cb of partialCbs) cb(finalText);
      resolveStop?.(finalText);
      resolveStop = null;
    } else if (ev.type === "error") {
      for (const cb of errorCbs) cb(new Error(ev.message));
    }
  });

  return {
    async start(opts) {
      const openPromise = opened
        ? Promise.resolve()
        : new Promise<void>((r) => {
            resolveOpen = r;
          });
      transport.send(
        JSON.stringify({
          type: "session.start",
          language: opts?.language ?? "en",
        }),
      );
      await openPromise;
    },
    pushPcm(chunk) {
      transport.send(chunk);
    },
    async stop() {
      const done = new Promise<string>((r) => {
        resolveStop = r;
        setTimeout(() => {
          if (resolveStop) {
            resolveStop(finalText);
            resolveStop = null;
          }
        }, 50);
      });
      transport.send(JSON.stringify({ type: "session.stop" }));
      const text = await done;
      transport.close();
      return text;
    },
    onPartial(cb) {
      partialCbs.push(cb);
    },
    onError(cb) {
      errorCbs.push(cb);
    },
  };
}

/** In-memory mock transport for tests. */
export function createMockSttTransport(): SttTransport & {
  emit(raw: string): void;
  emitOpen(): void;
  sent: Array<string | Uint8Array>;
} {
  let onMsg: ((d: string) => void) | null = null;
  let onOp: (() => void) | null = null;
  const sent: Array<string | Uint8Array> = [];
  return {
    sent,
    send(data) {
      if (typeof data === "string") sent.push(data);
      else if (data instanceof Uint8Array) sent.push(data);
      else sent.push(new Uint8Array(data));
    },
    close() {},
    onMessage(cb) {
      onMsg = cb;
    },
    onOpen(cb) {
      onOp = cb;
    },
    onError() {},
    onClose() {},
    emit(raw: string) {
      onMsg?.(raw);
    },
    emitOpen() {
      onOp?.();
    },
  };
}
