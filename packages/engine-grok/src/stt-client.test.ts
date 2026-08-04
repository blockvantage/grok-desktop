import { describe, it, expect } from "vitest";
import {
  parseSttServerMessage,
  createDictationSession,
  createMockSttTransport,
  encodeWavPcm16,
  concatPcm16,
  transcribeAudioFile,
  DEFAULT_STT_URL,
} from "./stt-client.js";

describe("parseSttServerMessage", () => {
  it("parses partial and done", () => {
    expect(
      parseSttServerMessage(JSON.stringify({ type: "partial", text: "hello" })),
    ).toEqual({ type: "partial", text: "hello" });
    expect(
      parseSttServerMessage(JSON.stringify({ type: "done", text: "hello world" })),
    ).toEqual({ type: "done", text: "hello world" });
  });

  it("parses batch HTTP { text } shape", () => {
    expect(
      parseSttServerMessage(JSON.stringify({ text: "hi", language: "en", duration: 1 })),
    ).toEqual({ type: "done", text: "hi" });
  });

  it("returns null for garbage", () => {
    expect(parseSttServerMessage("not-json")).toBeNull();
  });
});

describe("encodeWavPcm16 / concatPcm16", () => {
  it("builds a valid RIFF/WAVE header", () => {
    const pcm = new Int16Array([0, 1000, -1000, 0]);
    const wav = encodeWavPcm16(pcm, 16000);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
  });

  it("concatenates chunks", () => {
    const a = new Int16Array([1, 2]);
    const b = new Int16Array([3]);
    expect(Array.from(concatPcm16([a, b]))).toEqual([1, 2, 3]);
  });
});

describe("transcribeAudioFile", () => {
  it("POSTs multipart to default STT URL and parses text", async () => {
    let calledUrl = "";
    let calledHeaders: Record<string, string> = {};
    let body: Uint8Array | null = null;
    const pcm = new Int16Array(1600);
    const wav = encodeWavPcm16(pcm, 16000);
    const result = await transcribeAudioFile({
      accessToken: "tok",
      fileBytes: wav,
      language: "en",
      fetchImpl: async (url, init) => {
        calledUrl = url;
        calledHeaders = init.headers;
        body = init.body as Uint8Array;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ text: "hello grok", language: "en", duration: 0.1 }),
        };
      },
    });
    expect(calledUrl).toBe(DEFAULT_STT_URL);
    expect(calledHeaders.Authorization).toBe("Bearer tok");
    expect(calledHeaders["Content-Type"]).toMatch(/multipart\/form-data/);
    expect(body!.byteLength).toBeGreaterThan(wav.byteLength);
    // body includes wav bytes
    const bodyStr = Buffer.from(body!).toString("binary");
    expect(bodyStr.includes("RIFF")).toBe(true);
    expect(result.rawAvailable).toBe(true);
    expect(result.text).toBe("hello grok");
    expect(result.language).toBe("en");
  });

  it("returns error on HTTP failure", async () => {
    const wav = encodeWavPcm16(new Int16Array(16), 16000);
    const result = await transcribeAudioFile({
      accessToken: "tok",
      fileBytes: wav,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => "nope",
      }),
    });
    expect(result.rawAvailable).toBe(false);
    expect(result.error).toBe("http_401");
  });

  it("requires token", async () => {
    const r = await transcribeAudioFile({
      accessToken: "",
      fileBytes: new Uint8Array([1]),
    });
    expect(r.error).toBe("no_token");
  });

  it("returns network error when upload times out", async () => {
    const wav = encodeWavPcm16(new Int16Array(16), 16000);
    const result = await transcribeAudioFile({
      accessToken: "tok",
      fileBytes: wav,
      timeoutMs: 30,
      fetchImpl: (_url, init) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ text: "late" }),
            });
          }, 5_000);
          init.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    });
    expect(result.rawAvailable).toBe(false);
    expect(result.error).toBe("network");
  });

  it("honors caller signal without clobbering it", async () => {
    const wav = encodeWavPcm16(new Int16Array(16), 16000);
    const caller = new AbortController();
    const p = transcribeAudioFile({
      accessToken: "tok",
      fileBytes: wav,
      timeoutMs: 10_000,
      signal: caller.signal,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    });
    caller.abort();
    const result = await p;
    expect(result.rawAvailable).toBe(false);
    expect(result.error).toBe("network");
  });
});

describe("createDictationSession", () => {
  it("streams partials and returns final on stop", async () => {
    const transport = createMockSttTransport();
    const session = createDictationSession(transport);
    const partials: string[] = [];
    session.onPartial((t) => partials.push(t));
    const startP = session.start({ language: "en" });
    transport.emitOpen();
    await startP;
    transport.emit(JSON.stringify({ type: "partial", text: "hi" }));
    const stopP = session.stop();
    transport.emit(JSON.stringify({ type: "done", text: "hi there" }));
    const final = await stopP;
    expect(partials).toContain("hi");
    expect(final).toBe("hi there");
  });
});
