import { describe, it, expect } from "vitest";
import { escapeAppleScriptString } from "./mac-adapter";

describe("escapeAppleScriptString", () => {
  it("escapes quotes, backslashes, and line breaks", () => {
    expect(escapeAppleScriptString('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeAppleScriptString("a\\b")).toBe("a\\\\b");
    expect(escapeAppleScriptString("a\nb\rc\td")).toBe("a\\nb\\rc\\td");
  });

  it("strips NUL bytes", () => {
    expect(escapeAppleScriptString("a\0b")).toBe("ab");
  });
});
