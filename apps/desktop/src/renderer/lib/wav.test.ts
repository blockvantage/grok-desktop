import { describe, expect, it } from "vitest";
import { encodeWavBase64 } from "./wav";

describe("encodeWavBase64", () => {
  it("produces RIFF/WAVE header", () => {
    const b64 = encodeWavBase64([0, 1000, -1000, 0], 16_000);
    const bin = atob(b64);
    expect(bin.slice(0, 4)).toBe("RIFF");
    expect(bin.slice(8, 12)).toBe("WAVE");
    expect(bin.length).toBe(44 + 4 * 2);
  });
});
