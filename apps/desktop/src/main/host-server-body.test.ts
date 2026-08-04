import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import process from "node:process";
import type { IncomingMessage } from "node:http";
import {
  HOST_SERVER_MAX_BODY_BYTES,
  hostTokenMatches,
  readLimitedJsonBody,
} from "./host-server-body";

function fakeReq(chunks: Buffer[], opts?: { error?: Error }): IncomingMessage {
  const ee = new EventEmitter() as IncomingMessage & EventEmitter;
  (ee as { destroy: () => IncomingMessage }).destroy = () => {
    ee.emit("close");
    return ee as IncomingMessage;
  };
  process.nextTick(() => {
    if (opts?.error) {
      ee.emit("error", opts.error);
      return;
    }
    for (const c of chunks) ee.emit("data", c);
    ee.emit("end");
  });
  return ee as IncomingMessage;
}

describe("readLimitedJsonBody", () => {
  it("parses a small JSON object", async () => {
    const body = await readLimitedJsonBody(
      fakeReq([Buffer.from('{"taskId":"t1","tool":"desktop_type"}')]),
    );
    expect(body.taskId).toBe("t1");
  });

  it("rejects bodies over the max byte limit", async () => {
    const big = Buffer.alloc(HOST_SERVER_MAX_BODY_BYTES + 1, 0x61);
    await expect(readLimitedJsonBody(fakeReq([big]), 1024)).rejects.toThrow(
      "payload_too_large",
    );
  });

  it("rejects non-object JSON", async () => {
    await expect(
      readLimitedJsonBody(fakeReq([Buffer.from("[1,2,3]")])),
    ).rejects.toThrow("invalid_json_object");
  });

  it("rejects invalid JSON", async () => {
    await expect(
      readLimitedJsonBody(fakeReq([Buffer.from("{not-json")])),
    ).rejects.toThrow("invalid_json");
  });
});

describe("hostTokenMatches", () => {
  it("accepts equal tokens and rejects mismatches", () => {
    const tok = "a".repeat(48);
    expect(hostTokenMatches(tok, tok)).toBe(true);
    expect(hostTokenMatches(tok, "b".repeat(48))).toBe(false);
    expect(hostTokenMatches(undefined, tok)).toBe(false);
    expect(hostTokenMatches(["a", "b"], tok)).toBe(false);
    expect(hostTokenMatches("short", tok)).toBe(false);
  });
});
