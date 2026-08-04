import { describe, it, expect } from "vitest";
import {
  CELEBRATE_DONE_MS,
  toastForRevealResult,
} from "./reveal-result";

describe("toastForRevealResult", () => {
  it("errors when not ok", () => {
    expect(toastForRevealResult({ ok: false }, "fallback")).toEqual({
      kind: "error",
      message: "fallback",
    });
    expect(
      toastForRevealResult({ ok: false, error: "gone" }, "fallback"),
    ).toEqual({ kind: "error", message: "gone" });
  });

  it("infos when ok with soft error", () => {
    expect(
      toastForRevealResult({ ok: true, error: "opened parent" }, "x"),
    ).toEqual({ kind: "info", message: "opened parent" });
  });

  it("silent when clean ok", () => {
    expect(toastForRevealResult({ ok: true }, "x")).toEqual({ kind: "none" });
  });

  it("exports celebrate duration", () => {
    expect(CELEBRATE_DONE_MS).toBe(1300);
  });
});
