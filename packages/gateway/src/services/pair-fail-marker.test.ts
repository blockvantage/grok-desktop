import { describe, it, expect } from "vitest";
import {
  pairFailMarkerBytes,
  pairFailMarkerPayload,
} from "./pair-fail-marker.js";

describe("pair-fail-marker", () => {
  it("builds payload without secrets", () => {
    const p = pairFailMarkerPayload("expired");
    expect(p).toEqual({ kind: "pair_fail", reason: "expired" });
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/secret|key|token/i);
  });

  it("encodes to UTF-8 bytes", () => {
    const bytes = pairFailMarkerBytes("invalid");
    expect(new TextDecoder().decode(bytes)).toContain("pair_fail");
    expect(new TextDecoder().decode(bytes)).toContain("invalid");
  });
});
