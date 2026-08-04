import { describe, expect, it } from "vitest";
import {
  elapsedSince,
  formatElapsed,
  taskElapsedStartIso,
} from "./elapsed";

describe("formatElapsed", () => {
  it("formats zero and sub-minute", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(5)).toBe("0:05");
    expect(formatElapsed(59)).toBe("0:59");
  });

  it("formats minutes and long runs without hour split", () => {
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(3600)).toBe("60:00");
    expect(formatElapsed(3661)).toBe("61:01");
  });

  it("clamps negatives and non-finite to 0:00", () => {
    expect(formatElapsed(-3)).toBe("0:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
  });
});

describe("elapsedSince", () => {
  it("returns whole seconds between start and now", () => {
    expect(
      elapsedSince(
        "2026-07-17T00:00:00Z",
        Date.parse("2026-07-17T00:01:05Z"),
      ),
    ).toBe(65);
  });

  it("returns 0 for invalid or future starts", () => {
    expect(elapsedSince("not-a-date", Date.now())).toBe(0);
    expect(
      elapsedSince(
        "2026-07-17T00:02:00Z",
        Date.parse("2026-07-17T00:01:00Z"),
      ),
    ).toBe(0);
  });
});

describe("taskElapsedStartIso", () => {
  it("prefers createdAt over updatedAt", () => {
    expect(
      taskElapsedStartIso({
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:05:00.000Z",
      }),
    ).toBe("2026-07-17T00:00:00.000Z");
  });

  it("falls back to updatedAt when createdAt missing", () => {
    expect(
      taskElapsedStartIso({ updatedAt: "2026-07-17T00:05:00.000Z" }),
    ).toBe("2026-07-17T00:05:00.000Z");
  });

  it("returns null when nothing usable", () => {
    expect(taskElapsedStartIso({})).toBeNull();
    expect(taskElapsedStartIso({ createdAt: "nope" })).toBeNull();
  });
});
