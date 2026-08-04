import { useCallback, useEffect, useRef, useState } from "react";
import { writeTempAttachment } from "@/lib/api";
import { encodeWavBase64 } from "@/lib/wav";
import { getActiveLocale } from "@/i18n/active";

export type DictationUiState = "idle" | "listening" | "processing" | "error";

const TARGET_RATE = 16_000;
/** Cap keep-audio buffer (~90s mono 16 kHz) so long holds cannot balloon RAM. */
const MAX_KEEP_SAMPLES = TARGET_RATE * 90;

/**
 * STT language for a dictation start: explicit override, else active UI locale.
 * Main strips any BCP-47 region (`es-ES` → `es`); short LocaleCode values pass through.
 */
export function dictationLanguage(
  optsLanguage: string | undefined,
  activeLocale: string,
): string {
  const raw = (optsLanguage ?? activeLocale).trim();
  if (!raw) return "en";
  return raw.split("-")[0] || "en";
}

/**
 * Grok STT dictation: mic → PCM 16 kHz mono → main → api.x.ai/v1/stt.
 * Requires SuperGrok (same rails as Grok Build /voice).
 * Optional keep-audio stages a WAV via writeTempAttachment.
 */
export function useDictation(opts: {
  language?: string;
  signedIn?: boolean;
  onAppend: (text: string) => void;
  onAudioAttached?: (path: string) => void;
  /** Called when keep-audio staging fails (optional toast). */
  onAudioError?: (message: string) => void;
}) {
  const [state, setState] = useState<DictationUiState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [keepAudio, setKeepAudio] = useState(false);
  const baseTextRef = useRef("");
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const pcmSampleCountRef = useRef(0);
  const keepAudioRef = useRef(false);
  const onAppendRef = useRef(opts.onAppend);
  const onAudioRef = useRef(opts.onAudioAttached);
  const onAudioErrorRef = useRef(opts.onAudioError);
  onAppendRef.current = opts.onAppend;
  onAudioRef.current = opts.onAudioAttached;
  onAudioErrorRef.current = opts.onAudioError;
  keepAudioRef.current = keepAudio;

  useEffect(() => {
    const unsub1 = window.grokdesk?.dictation?.onPartial(({ text }) => {
      setInterim(text);
    });
    const unsub2 = window.grokdesk?.dictation?.onState((s) => {
      if (s.state === "listening") setState("listening");
      else if (s.state === "processing") setState("processing");
      else if (s.state === "error") {
        setState("error");
        setError(s.message ?? "dictation.error");
      } else if (s.state === "idle") {
        setState((prev) => (prev === "processing" ? prev : "idle"));
      }
    });
    return () => {
      unsub1?.();
      unsub2?.();
      // Release mic + STT session if the composer unmounts mid-utterance
      // (navigate away, chat switch). Avoid leaving capture open.
      try {
        procRef.current?.disconnect();
        sourceRef.current?.disconnect();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        void ctxRef.current?.close();
      } catch {
        /* ignore */
      }
      procRef.current = null;
      sourceRef.current = null;
      streamRef.current = null;
      ctxRef.current = null;
      void window.grokdesk?.dictation?.stop?.();
    };
  }, []);

  const stopCapture = useCallback(() => {
    try {
      procRef.current?.disconnect();
      sourceRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void ctxRef.current?.close();
    } catch {
      /* ignore */
    }
    procRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
  }, []);

  const start = useCallback(
    async (currentFieldValue: string) => {
      setError(null);
      setInterim("");
      setLevel(0);
      pcmChunksRef.current = [];
      pcmSampleCountRef.current = 0;
      baseTextRef.current = currentFieldValue;

      if (opts.signedIn === false) {
        setState("error");
        setError("dictation.supergrokRequired");
        return;
      }

      if (!window.grokdesk?.dictation?.start) {
        setState("error");
        setError("dictation.unsupported");
        return;
      }

      const startRes = await window.grokdesk.dictation.start({
        language: dictationLanguage(opts.language, getActiveLocale()),
      });
      if (!startRes?.ok) {
        setState("error");
        const err = startRes?.error ?? "";
        setError(
          err === "supergrok_required"
            ? "dictation.supergrokRequired"
            : err === "entitlement_read_only"
              ? "dictation.entitlementReadOnly"
              : err === "dictation_busy"
                ? "dictation.busy"
                : "dictation.error",
        );
        return;
      }

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          stopCapture();
          await window.grokdesk?.dictation?.stop();
          setState("error");
          setError("dictation.unsupported");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) {
          stopCapture();
          await window.grokdesk?.dictation?.stop();
          setState("error");
          setError("dictation.unsupported");
          return;
        }
        const ctx = new AudioCtx();
        ctxRef.current = ctx;
        // macOS / Chromium often starts AudioContext suspended until a resume.
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        procRef.current = proc;
        const inputRate = ctx.sampleRate;

        proc.onaudioprocess = (ev) => {
          const input = ev.inputBuffer.getChannelData(0);
          const ratio = inputRate / TARGET_RATE;
          const outLen = Math.floor(input.length / ratio);
          if (outLen <= 0) return;
          const pcm = new Int16Array(outLen);
          let sum = 0;
          for (let i = 0; i < outLen; i++) {
            const idx = Math.floor(i * ratio);
            const s = Math.max(-1, Math.min(1, input[idx]!));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            sum += s * s;
          }
          const rms = Math.sqrt(sum / outLen);
          setLevel(Math.min(1, rms * 4));
          // Buffer for optional keep-audio (capped); Keep can be toggled mid-recording.
          if (pcmSampleCountRef.current < MAX_KEEP_SAMPLES) {
            const room = MAX_KEEP_SAMPLES - pcmSampleCountRef.current;
            const slice = room < pcm.length ? pcm.subarray(0, room) : pcm;
            pcmChunksRef.current.push(
              slice === pcm ? pcm : new Int16Array(slice),
            );
            pcmSampleCountRef.current += slice.length;
          }
          void window.grokdesk?.dictation?.pushPcm?.(Array.from(pcm));
        };

        source.connect(proc);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        proc.connect(mute);
        mute.connect(ctx.destination);
        setState("listening");
        setInterim("");
      } catch (e) {
        stopCapture();
        await window.grokdesk?.dictation?.stop();
        setState("error");
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "dictation.denied"
            : name === "NotFoundError"
              ? "dictation.noMic"
              : "dictation.error",
        );
      }
    },
    [opts.language, opts.signedIn, stopCapture],
  );

  const stop = useCallback(async () => {
    const chunks = pcmChunksRef.current;
    const shouldKeep = keepAudioRef.current;
    stopCapture();
    setState("processing");
    setInterim("");
    setLevel(0);

    if (shouldKeep && chunks.length > 0 && onAudioRef.current) {
      try {
        let total = 0;
        for (const c of chunks) total += c.length;
        const merged = new Int16Array(total);
        let o = 0;
        for (const c of chunks) {
          merged.set(c, o);
          o += c.length;
        }
        const b64 = encodeWavBase64(merged, TARGET_RATE);
        const p = await writeTempAttachment(`voice-${Date.now()}.wav`, b64);
        if (p) onAudioRef.current(p);
        else onAudioErrorRef.current?.("attach_failed");
      } catch {
        onAudioErrorRef.current?.("attach_failed");
      }
    }
    pcmChunksRef.current = [];
    pcmSampleCountRef.current = 0;
    // One-shot per utterance — user re-enables Keep next time if needed.
    setKeepAudio(false);
    keepAudioRef.current = false;

    const res = await window.grokdesk?.dictation?.stop();
    setState("idle");
    if (!res?.ok && res?.error === "supergrok_required") {
      setError("dictation.supergrokRequired");
      setState("error");
      return;
    }
    if (!res?.ok && res?.error && res.error !== "too_short") {
      setError("dictation.sttFailed");
      setState("error");
      return;
    }
    const piece = (res?.text ?? "").trim();
    if (piece) {
      const base = baseTextRef.current.trimEnd();
      const next = base ? `${base} ${piece}` : piece;
      onAppendRef.current(next);
    }
  }, [stopCapture]);

  const toggle = useCallback(
    async (currentFieldValue: string) => {
      if (state === "listening" || state === "processing") await stop();
      else await start(currentFieldValue);
    },
    [state, start, stop],
  );

  return {
    state,
    error,
    interim,
    level,
    keepAudio,
    setKeepAudio,
    start,
    stop,
    toggle,
  };
}
