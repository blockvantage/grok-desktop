import { describe, it, expect } from "vitest";
import {
  isFileMissingError,
  previewLoadErrorContent,
  failedTextPreview,
} from "./preview-load-error";

describe("preview-load-error", () => {
  it("detects not found including ENOENT", () => {
    expect(isFileMissingError("File not found")).toBe(true);
    expect(isFileMissingError("ENOENT")).toBe(true);
    expect(isFileMissingError("EPERM")).toBe(false);
  });

  it("builds missing vs generic content", () => {
    expect(
      previewLoadErrorContent({
        detail: "File not found",
        missingHint: "gone",
        genericHint: "retry",
      }),
    ).toContain("gone");
    expect(
      previewLoadErrorContent({
        detail: "EPERM",
        missingHint: "gone",
        genericHint: "retry",
      }),
    ).toContain("retry");
  });

  it("failedTextPreview is truncated false", () => {
    expect(
      failedTextPreview({ path: "/a", name: "a", content: "x" }),
    ).toEqual({
      path: "/a",
      name: "a",
      content: "x",
      truncated: false,
    });
  });
});
