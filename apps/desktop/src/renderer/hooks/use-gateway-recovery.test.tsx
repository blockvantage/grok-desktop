import { describe, expect, it } from "vitest";
import { shouldResyncOnReadyEdge } from "./use-gateway-recovery";

describe("use-gateway-recovery", () => {
  it("resyncs only on edge into ready", () => {
    expect(shouldResyncOnReadyEdge(null, "ready")).toBe(true);
    expect(shouldResyncOnReadyEdge("starting", "ready")).toBe(true);
    expect(shouldResyncOnReadyEdge("restarting", "ready")).toBe(true);
    expect(shouldResyncOnReadyEdge("dead", "ready")).toBe(true);
    expect(shouldResyncOnReadyEdge("ready", "ready")).toBe(false);
    expect(shouldResyncOnReadyEdge("ready", "dead")).toBe(false);
    expect(shouldResyncOnReadyEdge("starting", "restarting")).toBe(false);
  });
});
