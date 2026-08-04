import { describe, it, expect } from "vitest";
import { okResponse, okWithPayload } from "./simple-ok.js";

describe("simple-ok", () => {
  it("returns ok", () => {
    expect(okResponse()).toEqual({ ok: true });
  });

  it("merges payload", () => {
    expect(okWithPayload({ id: "1" })).toEqual({ ok: true, id: "1" });
  });
});
