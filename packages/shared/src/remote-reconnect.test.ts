import { describe, expect, it } from "vitest";
import {
  initialConnectionModel,
  nextBackoffMs,
  reduceConnection,
  shouldKeepReconnecting,
} from "./remote-reconnect.js";

describe("remote-reconnect", () => {
  it("starts offline", () => {
    const m = initialConnectionModel();
    expect(m.state).toBe("offline");
    expect(m.label).toBe("Offline");
  });

  it("transitions connect_start → reconnecting, connect_ok → online", () => {
    let m = initialConnectionModel();
    m = reduceConnection(m, { type: "connect_start" });
    expect(m.state).toBe("reconnecting");
    expect(m.label).toMatch(/Connecting|Reconnecting/i);
    m = reduceConnection(m, { type: "connect_ok" });
    expect(m.state).toBe("online");
    expect(m.label).toBe("Online");
    expect(m.attempt).toBe(0);
  });

  it("surfaces queue_flush_error while remaining online", () => {
    let m = reduceConnection(initialConnectionModel(), { type: "connect_ok" });
    m = reduceConnection(m, {
      type: "queue_flush_error",
      error: "permanent fail",
    });
    expect(m.state).toBe("online");
    expect(m.queueError).toBe("permanent fail");
    expect(m.label).toMatch(/queue.*permanent fail/i);
    m = reduceConnection(m, { type: "queue_flush_ok" });
    expect(m.queueError).toBeNull();
    expect(m.label).toBe("Online");
  });

  it("connect_ok clears a prior queueError (stale chrome after clean reconnect)", () => {
    let m = reduceConnection(initialConnectionModel(), { type: "connect_ok" });
    m = reduceConnection(m, {
      type: "queue_flush_error",
      error: "old permanent fail",
    });
    expect(m.queueError).toBe("old permanent fail");
    m = reduceConnection(m, { type: "disconnect" });
    m = reduceConnection(m, { type: "connect_ok" });
    expect(m.state).toBe("online");
    expect(m.queueError).toBeNull();
    expect(m.label).toBe("Online");
  });

  it("connect_fail increments attempt and stays reconnecting until give_up", () => {
    let m = initialConnectionModel();
    m = reduceConnection(m, { type: "connect_start" });
    m = reduceConnection(m, { type: "connect_fail", error: "ws error" });
    expect(m.state).toBe("reconnecting");
    expect(m.attempt).toBe(1);
    expect(m.lastError).toBe("ws error");
    m = reduceConnection(m, { type: "connect_fail", error: "timeout" });
    expect(m.attempt).toBe(2);
    m = reduceConnection(m, { type: "give_up" });
    expect(m.state).toBe("offline");
    expect(m.label).toMatch(/Offline/);
  });

  it("disconnect from online enters reconnecting; successful reconnect resets attempt", () => {
    let m = reduceConnection(initialConnectionModel(), { type: "connect_ok" });
    m = reduceConnection(m, { type: "disconnect" });
    expect(m.state).toBe("reconnecting");
    m = reduceConnection(m, { type: "connect_fail", error: "drop" });
    expect(m.attempt).toBe(1);
    m = reduceConnection(m, { type: "connect_ok" });
    expect(m.state).toBe("online");
    expect(m.attempt).toBe(0);
    expect(m.lastError).toBeNull();
  });

  it("nextBackoffMs doubles then caps (no jitter)", () => {
    expect(nextBackoffMs(0, { baseMs: 500, maxMs: 8_000, jitter: 0 })).toBe(500);
    expect(nextBackoffMs(1, { baseMs: 500, maxMs: 8_000, jitter: 0 })).toBe(1000);
    expect(nextBackoffMs(2, { baseMs: 500, maxMs: 8_000, jitter: 0 })).toBe(2000);
    expect(nextBackoffMs(10, { baseMs: 500, maxMs: 8_000, jitter: 0 })).toBe(8000);
  });

  it("nextBackoffMs applies ±25% jitter (CX-9)", () => {
    const mid = nextBackoffMs(0, {
      baseMs: 1000,
      maxMs: 30_000,
      jitter: 0.25,
      random: () => 0.5,
    });
    expect(mid).toBe(1000);
    const low = nextBackoffMs(0, {
      baseMs: 1000,
      maxMs: 30_000,
      jitter: 0.25,
      random: () => 0,
    });
    expect(low).toBe(750);
    const high = nextBackoffMs(0, {
      baseMs: 1000,
      maxMs: 30_000,
      jitter: 0.25,
      random: () => 1,
    });
    expect(high).toBe(1250);
  });

  it("shouldKeepReconnecting never gives up by default (CX-9 foreground)", () => {
    expect(shouldKeepReconnecting(0)).toBe(true);
    expect(shouldKeepReconnecting(100)).toBe(true);
    expect(shouldKeepReconnecting(2, 3)).toBe(true);
    expect(shouldKeepReconnecting(3, 3)).toBe(false);
  });
});
