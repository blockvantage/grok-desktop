import { describe, expect, it } from "vitest";
import { MAX_RELAY_PEERS, RelayStore } from "./store.js";

describe("RelayStore", () => {
  it("routes opaque blobs between desk and phone without reading them", () => {
    const store = new RelayStore();
    const received: unknown[] = [];
    const deskOk = store.register({
      id: "d1",
      role: "desk",
      machineId: "m1",
      token: "desk-token",
      push: (m) => received.push(m),
    });
    expect(deskOk.ok).toBe(true);
    const phoneOk = store.register({
      id: "p1",
      role: "phone",
      machineId: "m1",
      deviceId: "dev1",
      token: "phone-token",
      push: () => {},
    });
    expect(phoneOk.ok).toBe(true);

    const secretBlob = "QUFBQUFBQUFBQUFB"; // opaque
    const r = store.send("p1", "pair:m1", secretBlob);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.delivered).toBe(1);
    expect(received).toHaveLength(1);
    const msg = received[0] as { type: string; blob: string; channel: string };
    expect(msg.type).toBe("recv");
    expect(msg.channel).toBe("pair:m1");
    expect(msg.blob).toBe(secretBlob);
    // store stats never expose blob
    expect(JSON.stringify(store.stats())).not.toContain(secretBlob);
  });

  it("rejects channel for wrong machine", () => {
    const store = new RelayStore();
    store.register({
      id: "p1",
      role: "phone",
      machineId: "m1",
      deviceId: "d",
      token: "t",
      push: () => {},
    });
    const r = store.send("p1", "pair:other", "xx");
    expect(r.ok).toBe(false);
  });

  it("rejects oversized blobs", () => {
    const store = new RelayStore();
    store.register({
      id: "d1",
      role: "desk",
      machineId: "m1",
      token: "t",
      push: () => {},
    });
    const big = "a".repeat(400_000);
    const r = store.send("d1", "pair:m1", big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("blob_too_large");
  });

  it("rejects desk re-register with a different token (CX-4)", () => {
    const store = new RelayStore();
    const a = store.register({
      id: "d1",
      role: "desk",
      machineId: "m1",
      token: "token-a",
      push: () => {},
    });
    expect(a.ok).toBe(true);
    // same token reconnect ok
    const same = store.register({
      id: "d2",
      role: "desk",
      machineId: "m1",
      token: "token-a",
      push: () => {},
    });
    expect(same.ok).toBe(true);
    // different token rejected
    const bad = store.register({
      id: "d3",
      role: "desk",
      machineId: "m1",
      token: "token-b",
      push: () => {},
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("token_mismatch");
  });

  it("rejects register when at peer capacity", () => {
    const store = new RelayStore({ maxPeers: 1 });
    expect(
      store.register({
        id: "d1",
        role: "desk",
        machineId: "m1",
        token: "t",
        push: () => {},
      }).ok,
    ).toBe(true);
    const full = store.register({
      id: "p1",
      role: "phone",
      machineId: "m1",
      deviceId: "d",
      token: "t2",
      push: () => {},
    });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.code).toBe("capacity");
    expect(MAX_RELAY_PEERS).toBeGreaterThan(100);
  });

  it("rejects oversized channel names", () => {
    const store = new RelayStore();
    store.register({
      id: "d1",
      role: "desk",
      machineId: "m1",
      token: "t",
      push: () => {},
    });
    const r = store.send("d1", "c".repeat(300), "xx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bad_channel");
  });
});
