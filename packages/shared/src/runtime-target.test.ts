import { describe, it, expect } from "vitest";
import {
  CANONICAL_RUNTIME_TARGETS,
  QUALIFIED_PUBLICATION_TARGETS,
  isCanonicalRuntimeTarget,
  isQualifiedPublicationTarget,
  isPublishedTarget,
  toRuntimeTarget,
} from "./runtime-target.js";

describe("toRuntimeTarget", () => {
  it("maps process.platform + process.arch to canonical targets", () => {
    expect(toRuntimeTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(toRuntimeTarget("darwin", "x64")).toBe("darwin-x64");
    expect(toRuntimeTarget("win32", "x64")).toBe("win32-x64");
    expect(toRuntimeTarget("win32", "arm64")).toBe("win32-arm64");
  });

  it("returns unsupported for non-qualified platforms", () => {
    expect(toRuntimeTarget("linux", "x64")).toBe("unsupported");
    expect(toRuntimeTarget("linux", "arm64")).toBe("unsupported");
    expect(toRuntimeTarget("freebsd", "x64")).toBe("unsupported");
    expect(toRuntimeTarget("darwin", "ia32")).toBe("unsupported");
  });

  it("is case-insensitive for platform/arch inputs", () => {
    expect(toRuntimeTarget("Darwin", "ARM64")).toBe("darwin-arm64");
    expect(toRuntimeTarget("WIN32", "X64")).toBe("win32-x64");
  });
});

describe("canonical and publication targets", () => {
  it("includes win32-arm64 in the type/target set", () => {
    expect(CANONICAL_RUNTIME_TARGETS).toContain("win32-arm64");
    expect(isCanonicalRuntimeTarget("win32-arm64")).toBe(true);
  });

  it("marks only qualified targets for launch publication", () => {
    expect(QUALIFIED_PUBLICATION_TARGETS).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "win32-x64",
    ]);
    expect(isQualifiedPublicationTarget("darwin-arm64")).toBe(true);
    expect(isQualifiedPublicationTarget("win32-arm64")).toBe(false);
  });

  it("treats win32-arm64 as unpublished until present in publishedTargets", () => {
    const published = ["darwin-arm64", "darwin-x64", "win32-x64"] as const;
    expect(isPublishedTarget("win32-arm64", published)).toBe(false);
    expect(isPublishedTarget("darwin-arm64", published)).toBe(true);
    expect(
      isPublishedTarget("win32-arm64", [...published, "win32-arm64"]),
    ).toBe(true);
  });
});
