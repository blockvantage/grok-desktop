import { describe, it, expect } from "vitest";
import {
  isConnectionLevelRelayCode,
  isDeskRpcTimeoutError,
  KEY_SKEW_MESSAGE,
  timeoutStreakAction,
} from "./remote-timeout-policy";

describe("remote-timeout-policy", () => {
  it("detects desk RPC timeouts vs skew/revoke strings", () => {
    expect(
      isDeskRpcTimeoutError(
        "timeout tasks.list — desk did not answer. Check same Wi‑Fi",
      ),
    ).toBe(true);
    expect(
      isDeskRpcTimeoutError("Session keys out of sync with desk"),
    ).toBe(false);
    expect(isDeskRpcTimeoutError("pairing revoked")).toBe(false);
  });

  it("first timeout reconnects; second is fatal key skew", () => {
    expect(timeoutStreakAction(0)).toEqual({
      type: "reconnect",
      nextStreak: 1,
    });
    expect(timeoutStreakAction(1)).toEqual({
      type: "fatal_key_skew",
      nextStreak: 2,
    });
  });

  it("classifies connection-level relay codes", () => {
    expect(isConnectionLevelRelayCode("desk_offline")).toBe(true);
    expect(isConnectionLevelRelayCode("blob_too_large")).toBe(false);
  });

  it("exports key skew message", () => {
    expect(KEY_SKEW_MESSAGE).toMatch(/Unpair/);
  });
});
