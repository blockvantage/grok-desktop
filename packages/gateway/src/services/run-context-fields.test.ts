import { describe, it, expect } from "vitest";
import {
  systemPreambleFromContext,
  requestIdFromContext,
} from "./run-context-fields.js";

describe("run-context-fields", () => {
  it("systemPreambleFromContext", () => {
    expect(systemPreambleFromContext(null)).toBe("");
    expect(systemPreambleFromContext({})).toBe("");
    expect(
      systemPreambleFromContext({ systemPreamble: "memo" }),
    ).toBe("memo");
  });

  it("requestIdFromContext", () => {
    expect(requestIdFromContext(null)).toBeNull();
    expect(requestIdFromContext({ requestId: "r1" })).toBe("r1");
    expect(requestIdFromContext({ requestId: "" })).toBeNull();
  });
});
