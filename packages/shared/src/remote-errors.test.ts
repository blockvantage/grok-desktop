import { describe, expect, it } from "vitest";
import {
  classifyRemoteError,
  remoteErrorLabel,
} from "./remote-errors.js";

describe("remote-errors (P4)", () => {
  it("classifies revoke as fatal session", () => {
    const c = classifyRemoteError(new Error("Device revoked"));
    expect(c.kind).toBe("revoked");
    expect(c.fatalSession).toBe(true);
    expect(remoteErrorLabel(c.kind)).toMatch(/re-pair/i);
  });

  it("classifies offline / timeout / not_allowed / pair_expired", () => {
    expect(classifyRemoteError("not connected").kind).toBe("offline");
    expect(classifyRemoteError("ws open timeout").kind).toBe("offline");
    expect(classifyRemoteError("timeout tasks.list").kind).toBe("timeout");
    expect(classifyRemoteError("method not allowed").kind).toBe("not_allowed");
    expect(classifyRemoteError("pairing challenge expired").kind).toBe(
      "pair_expired",
    );
    expect(classifyRemoteError("method not allowed").fatalSession).toBe(false);
  });

  it("never marks bare RPC timeout / desk-did-not-answer as fatal (CX-1)", () => {
    const timeout = classifyRemoteError(
      new Error(
        "timeout tasks.list — desk did not answer. Check same Wi‑Fi and that Remote is Connected on the Mac.",
      ),
    );
    expect(timeout.kind).toBe("timeout");
    expect(timeout.fatalSession).toBe(false);

    const bare = classifyRemoteError("Request timed out: timeout");
    expect(bare.kind).toBe("timeout");
    expect(bare.fatalSession).toBe(false);
  });

  it("still marks true key-skew / revoke strings as fatal", () => {
    expect(
      classifyRemoteError(
        "Session keys out of sync with desk — Unpair, then scan a new QR",
      ).fatalSession,
    ).toBe(true);
    expect(classifyRemoteError("invalid tag").fatalSession).toBe(true);
  });

  it("unknown errors are non-fatal", () => {
    const c = classifyRemoteError(new Error("weird boom"));
    expect(c.kind).toBe("unknown");
    expect(c.fatalSession).toBe(false);
  });
});
