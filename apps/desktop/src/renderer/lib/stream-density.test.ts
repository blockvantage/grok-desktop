import { describe, it, expect } from "vitest";
import { isStreamDensity, STREAM_DENSITIES } from "./stream-density";

describe("stream-density", () => {
  it("lists modes", () => {
    expect(STREAM_DENSITIES).toEqual(["chat", "tools", "log"]);
  });

  it("type guards", () => {
    expect(isStreamDensity("chat")).toBe(true);
    expect(isStreamDensity("tools")).toBe(true);
    expect(isStreamDensity("log")).toBe(true);
    expect(isStreamDensity("full")).toBe(false);
  });
});
