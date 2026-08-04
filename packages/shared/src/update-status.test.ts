import { describe, expect, it } from "vitest";
import {
  idleUpdateStatus,
  parseUpdateStatus,
  UpdateStatusSchema,
} from "./update-status.js";

describe("UpdateStatusSchema bounds", () => {
  it("accepts idle status", () => {
    const s = idleUpdateStatus({
      channel: "stable",
      target: "darwin-arm64",
      installed: { deskVersion: "0.1.6", grokVersion: "0.9.4" },
    });
    expect(parseUpdateStatus(s).phase).toBe("idle");
  });

  it("rejects oversized version / error strings", () => {
    expect(() =>
      UpdateStatusSchema.parse({
        phase: "error",
        channel: "stable",
        target: "darwin-arm64",
        installed: {
          deskVersion: "v".repeat(65),
          grokVersion: "0.1.0",
        },
      }),
    ).toThrow();
    expect(() =>
      UpdateStatusSchema.parse({
        phase: "error",
        channel: "stable",
        target: "darwin-arm64",
        error: {
          code: "c".repeat(129),
          message: "fail",
        },
      }),
    ).toThrow();
    expect(() =>
      UpdateStatusSchema.parse({
        phase: "error",
        channel: "stable",
        target: "darwin-arm64",
        error: {
          code: "verify_failed",
          message: "m".repeat(2_001),
        },
      }),
    ).toThrow();
  });

  it("rejects oversized available pair ids", () => {
    expect(() =>
      UpdateStatusSchema.parse({
        phase: "available",
        channel: "stable",
        target: "darwin-arm64",
        available: {
          pairId: "p".repeat(257),
          deskVersion: "1.0.0",
          grokVersion: "1.0.0",
          channel: "stable",
        },
      }),
    ).toThrow();
  });
});
