/**
 * Grok STT dictation (SuperGrok → https://api.x.ai/v1/stt).
 *
 * Renderer captures mic as PCM s16le @ 16 kHz mono, streams chunks here.
 * On stop, main wraps WAV and multipart-POSTs to Grok STT. Tokens never
 * enter the renderer.
 *
 * Requires SuperGrok session (same rails as Grok Build /voice).
 *
 * Entitlement: Grok-backed capture and upload are gated by an injectable
 * check (action `dictation`). Prefer DI over a global singleton so tests
 * can pass fakes. Local state queries remain ungated.
 */
import { BrowserWindow, ipcMain } from "electron";
import {
  concatPcm16,
  encodeWavPcm16,
  resolveManagedGrokBinary,
  probeModelsViaCli,
  readSuperGrokAccessToken,
  transcribeAudioFile,
} from "@grokdesk/engine-grok";
import {
  ensureDictationEntitlement,
  type DictationEntitlementGate,
} from "./dictation-entitlement.js";

export type {
  DictationEntitlementGate,
} from "./dictation-entitlement.js";
export {
  ensureDictationEntitlement,
  dictationGateFromAssert,
} from "./dictation-entitlement.js";

type DictationState = "idle" | "listening" | "processing" | "error";

const SAMPLE_RATE = 16_000;
const MAX_PCM_SAMPLES = SAMPLE_RATE * 120; // 2 minutes safety cap

let state: DictationState = "idle";
let language = "en";
let pcmChunks: Int16Array[] = [];
let pcmSamples = 0;
// Synchronous single-flight guard for start(): set before the async admission/
// token gates so an overlapping start can't resetBuffer() an in-flight session.
let starting = false;

export type RegisterDictationIpcOptions = {
  entitlementGate?: DictationEntitlementGate | null;
  /** Privileged-sender gate (validatePrivilegedIpcSender). Required in production. */
  assertSender?: (event: unknown) => void;
};

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function setState(next: DictationState, message?: string): void {
  state = next;
  broadcast("grokdesk:dictation:state", {
    state: next,
    message,
    mode: "grok_stt",
  });
}

function resetBuffer(): void {
  pcmChunks = [];
  pcmSamples = 0;
}

function toInt16(chunk: ArrayBuffer | Uint8Array | number[]): Int16Array {
  if (Array.isArray(chunk)) {
    return Int16Array.from(chunk);
  }
  const u8 =
    chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
  // Assume little-endian s16le byte stream
  if (u8.byteLength % 2 !== 0) {
    return new Int16Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 2));
  }
  return new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2);
}

async function resolveToken(): Promise<string | null> {
  let tok = await readSuperGrokAccessToken();
  if (tok?.accessToken) return tok.accessToken;
  try {
    const binary = await resolveManagedGrokBinary();
    if (binary) {
      await probeModelsViaCli(binary);
      tok = await readSuperGrokAccessToken();
      if (tok?.accessToken) return tok.accessToken;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function registerDictationIpc(
  opts?: RegisterDictationIpcOptions,
): void {
  const entitlementGate = opts?.entitlementGate ?? null;
  const gateSender = (event: unknown) => {
    if (typeof opts?.assertSender !== "function") {
      throw new Error(
        "IPC sender rejected: dictation assertSender not configured (fail-closed)",
      );
    }
    opts.assertSender(event);
  };

  ipcMain.handle(
    "grokdesk:dictation:start",
    async (e, optsIn?: { language?: string }) => {
      gateSender(e);
      // Single-flight: reject an overlapping start before the async gates, so a
      // second start can't wipe the PCM buffer of an already-listening session.
      if (starting || state === "listening" || state === "processing") {
        return { ok: false, error: "dictation_busy", mode: "grok_stt" };
      }
      starting = true;
      try {
        const admission = await ensureDictationEntitlement(
          entitlementGate,
          "capture_start",
        );
        if (!admission.ok) {
          setState("error", "dictation.entitlementReadOnly");
          return {
            ok: false,
            error: admission.error,
            ...(admission.state ? { state: admission.state } : {}),
            mode: "grok_stt",
          };
        }
        const token = await resolveToken();
        if (!token) {
          setState("error", "dictation.supergrokRequired");
          return { ok: false, error: "supergrok_required", mode: "grok_stt" };
        }
        language = (optsIn?.language ?? "en").split("-")[0] || "en";
        resetBuffer();
        setState("listening");
        return { ok: true, mode: "grok_stt" as const, sampleRate: SAMPLE_RATE };
      } finally {
        starting = false;
      }
    },
  );

  ipcMain.handle(
    "grokdesk:dictation:pushPcm",
    async (e, chunk: ArrayBuffer | Uint8Array | number[]) => {
      gateSender(e);
      if (state !== "listening") return { ok: false };
      const pcm = toInt16(chunk);
      if (pcm.length === 0) return { ok: true };
      if (pcmSamples + pcm.length > MAX_PCM_SAMPLES) {
        return { ok: false, error: "too_long" };
      }
      pcmChunks.push(pcm);
      pcmSamples += pcm.length;
      return { ok: true, samples: pcmSamples };
    },
  );

  /** Optional live text from renderer (unused for pure Grok STT). */
  ipcMain.handle(
    "grokdesk:dictation:pushPartial",
    async (e, text: string) => {
      gateSender(e);
      const raw = String(text ?? "");
      // Cap broadcast size so a runaway partial cannot flood renderers.
      const clipped = raw.length > 8_000 ? raw.slice(0, 8_000) : raw;
      broadcast("grokdesk:dictation:partial", { text: clipped });
      return { ok: true };
    },
  );

  ipcMain.handle("grokdesk:dictation:stop", async (e) => {
    gateSender(e);
    if (state !== "listening" && state !== "processing") {
      resetBuffer();
      setState("idle");
      return { ok: true, text: "", mode: "grok_stt" };
    }
    setState("processing");
    const samples = concatPcm16(pcmChunks);
    resetBuffer();

    if (samples.length < SAMPLE_RATE * 0.15) {
      setState("idle");
      return { ok: true, text: "", mode: "grok_stt", error: "too_short" };
    }

    // Re-check before upload — lease may have expired mid-capture.
    const admission = await ensureDictationEntitlement(
      entitlementGate,
      "stt_upload",
    );
    if (!admission.ok) {
      setState("error", "dictation.entitlementReadOnly");
      return {
        ok: false,
        text: "",
        error: admission.error,
        ...(admission.state ? { state: admission.state } : {}),
        mode: "grok_stt",
      };
    }

    const token = await resolveToken();
    if (!token) {
      setState("error", "dictation.supergrokRequired");
      return { ok: false, text: "", error: "supergrok_required", mode: "grok_stt" };
    }

    try {
      const wav = encodeWavPcm16(samples, SAMPLE_RATE);
      const result = await transcribeAudioFile({
        accessToken: token,
        fileBytes: wav,
        filename: "speech.wav",
        contentType: "audio/wav",
        language,
      });
      if (!result.rawAvailable) {
        setState("error", "dictation.sttFailed");
        return {
          ok: false,
          text: "",
          error: result.error ?? "stt_failed",
          mode: "grok_stt",
        };
      }
      const text = result.text.trim();
      if (text) {
        broadcast("grokdesk:dictation:partial", { text });
      }
      setState("idle");
      return {
        ok: true,
        text,
        language: result.language,
        duration: result.duration,
        mode: "grok_stt" as const,
      };
    } catch (err) {
      setState("error", "dictation.sttFailed");
      return {
        ok: false,
        text: "",
        error: err instanceof Error ? err.message : "stt_failed",
        mode: "grok_stt",
      };
    }
  });

  ipcMain.handle("grokdesk:dictation:state", async (event) => {
    gateSender(event);
    return { state, mode: "grok_stt", sampleRate: SAMPLE_RATE };
  });
}
