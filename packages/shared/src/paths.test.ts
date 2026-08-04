import { describe, it, expect } from "vitest";
import {
  normalizeRoot,
  isPathInsideRoot,
  isPathInsideAnyRoot,
  assertAbsolutePath,
} from "./paths.js";
import path from "node:path";

describe("paths", () => {
  it("rejects relative paths", () => {
    expect(() => assertAbsolutePath("foo/bar")).toThrow(/absolute/i);
  });

  it("detects path inside root (posix-style logical)", () => {
    const root = path.resolve("/Users/me/work");
    const child = path.resolve("/Users/me/work/campaign/a.md");
    expect(isPathInsideRoot(child, root)).toBe(true);
  });

  it("rejects path escape with ..", () => {
    const root = path.resolve("/Users/me/work");
    const escape = path.resolve("/Users/me/work/../secret");
    expect(isPathInsideRoot(escape, root)).toBe(false);
  });

  it("normalizes trailing separators", () => {
    const a = normalizeRoot(path.resolve("/tmp/ws") + path.sep);
    const b = normalizeRoot(path.resolve("/tmp/ws"));
    expect(a).toBe(b);
  });

  it("isPathInsideAnyRoot checks multiple roots", () => {
    const a = path.resolve("/a");
    const b = path.resolve("/b");
    expect(isPathInsideAnyRoot(path.join(b, "x"), [a, b])).toBe(true);
    expect(isPathInsideAnyRoot(path.resolve("/c/x"), [a, b])).toBe(false);
  });

  it("treats Windows drive paths as case-insensitive", () => {
    expect(isPathInsideRoot("C:/Work/file.txt", "c:/work")).toBe(true);
    expect(isPathInsideRoot("C:/Work/file.txt", "C:/Other")).toBe(false);
    // Posix remains case-sensitive.
    expect(isPathInsideRoot("/Users/Me/a", "/Users/me")).toBe(false);
  });
});
