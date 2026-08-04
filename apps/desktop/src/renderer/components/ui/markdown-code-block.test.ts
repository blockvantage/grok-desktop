import { describe, expect, it } from "vitest";
import { codeBlockOverflows } from "./markdown";

describe("codeBlockOverflows", () => {
  it("detects content taller than the clamped viewport", () => {
    expect(codeBlockOverflows(800, 448)).toBe(true);
    expect(codeBlockOverflows(448, 448)).toBe(false);
    expect(codeBlockOverflows(449, 448)).toBe(false); // within 1px tolerance
    expect(codeBlockOverflows(450, 448)).toBe(true);
  });
});
