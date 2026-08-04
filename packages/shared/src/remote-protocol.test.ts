import { describe, expect, it } from "vitest";
import {
  controlChannel,
  PairAcceptPlainSchema,
  PairOfferPlainSchema,
  parseControlPlain,
  pairChannel,
  RelayClientMsgSchema,
  serializeControlPlain,
} from "./remote-protocol.js";

describe("remote-protocol", () => {
  it("round-trips req frames", () => {
    const plain = {
      t: "req" as const,
      id: "1",
      method: "tasks.list",
      params: {},
    };
    const again = parseControlPlain(serializeControlPlain(plain));
    expect(again).toEqual(plain);
  });

  it("builds channel names", () => {
    expect(pairChannel("m1")).toBe("pair:m1");
    expect(controlChannel("m1", "d1")).toBe("ctrl:m1:d1");
  });

  it("rejects oversized control-frame string fields", () => {
    const huge = "x".repeat(129);
    expect(() =>
      parseControlPlain(
        serializeControlPlain({
          t: "req",
          id: huge,
          method: "tasks.list",
          params: {},
        }),
      ),
    ).toThrow();
    expect(() =>
      parseControlPlain(
        serializeControlPlain({
          t: "req",
          id: "1",
          method: huge,
          params: {},
        }),
      ),
    ).toThrow();
    expect(() =>
      parseControlPlain(
        serializeControlPlain({
          t: "hello",
          role: "phone",
          deviceId: huge,
          protocol: 2,
        }),
      ),
    ).toThrow();
    expect(() =>
      parseControlPlain(
        serializeControlPlain({
          t: "res",
          id: "1",
          ok: false,
          error: "e".repeat(8_001),
        }),
      ),
    ).toThrow();
  });

  it("rejects oversized pair offer/accept fields", () => {
    const okPub = "A".repeat(43);
    const okSecret = "B".repeat(43);
    expect(
      PairOfferPlainSchema.parse({
        v: 1,
        kind: "pair_offer",
        deviceId: "dev-1",
        deviceLabel: "Phone",
        devicePub: okPub,
        pairSecret: okSecret,
      }).deviceId,
    ).toBe("dev-1");
    expect(() =>
      PairOfferPlainSchema.parse({
        v: 1,
        kind: "pair_offer",
        deviceId: "x".repeat(129),
        deviceLabel: "Phone",
        devicePub: okPub,
        pairSecret: okSecret,
      }),
    ).toThrow();
    expect(() =>
      PairOfferPlainSchema.parse({
        v: 1,
        kind: "pair_offer",
        deviceId: "dev-1",
        deviceLabel: "Phone",
        devicePub: "p".repeat(257),
        pairSecret: okSecret,
      }),
    ).toThrow();
    expect(() =>
      PairOfferPlainSchema.parse({
        v: 1,
        kind: "pair_offer",
        deviceId: "dev-1",
        deviceLabel: "Phone",
        devicePub: okPub,
        pairSecret: "s".repeat(257),
      }),
    ).toThrow();
    expect(() =>
      PairAcceptPlainSchema.parse({
        v: 1,
        kind: "pair_accept",
        machineId: "m".repeat(129),
        machinePub: okPub,
        deviceId: "dev-1",
        deviceToken: okSecret,
        channel: "ctrl:m:d",
      }),
    ).toThrow();
  });

  it("rejects oversized relay hello/send envelopes", () => {
    expect(
      RelayClientMsgSchema.parse({
        type: "hello",
        role: "phone",
        machineId: "mach",
        token: "t".repeat(43),
      }).type,
    ).toBe("hello");
    expect(() =>
      RelayClientMsgSchema.parse({
        type: "hello",
        role: "phone",
        machineId: "m".repeat(129),
        token: "tok",
      }),
    ).toThrow();
    expect(() =>
      RelayClientMsgSchema.parse({
        type: "send",
        channel: "c".repeat(257),
        blob: "YQ",
      }),
    ).toThrow();
    expect(() =>
      RelayClientMsgSchema.parse({
        type: "send",
        channel: "ctrl:m:d",
        blob: "b".repeat(700_001),
      }),
    ).toThrow();
  });
});
