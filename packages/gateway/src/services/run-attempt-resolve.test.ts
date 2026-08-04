import { describe, it, expect } from "vitest";
import {
  errorMessageFromUnknown,
  resolveAttemptIdForStart,
} from "./run-attempt-resolve.js";

describe("resolveAttemptIdForStart", () => {
  const isTerminal = (s: string) =>
    s === "done" || s === "failed" || s === "cancelled";

  it("prefers claimed attempt", () => {
    expect(
      resolveAttemptIdForStart({
        latest: { id: "old", status: "queued" },
        claimed: { id: "new", status: "leased" },
        isTerminal,
      }),
    ).toBe("new");
  });

  it("returns null for a non-terminal latest when another instance won the claim", () => {
    expect(
      resolveAttemptIdForStart({
        latest: { id: "a1", status: "queued" },
        claimed: null,
        isTerminal,
      }),
    ).toBeNull();
  });

  it("returns null for a terminal latest when claimed is missing", () => {
    expect(
      resolveAttemptIdForStart({
        latest: { id: "done1", status: "done" },
        claimed: null,
        isTerminal,
      }),
    ).toBeNull();
  });

  it("returns null when nothing available", () => {
    expect(
      resolveAttemptIdForStart({
        latest: null,
        claimed: null,
        isTerminal,
      }),
    ).toBeNull();
  });
});

describe("errorMessageFromUnknown", () => {
  it("unwraps Error and stringifies others", () => {
    expect(errorMessageFromUnknown(new Error("boom"))).toBe("boom");
    expect(errorMessageFromUnknown("x")).toBe("x");
  });
});
