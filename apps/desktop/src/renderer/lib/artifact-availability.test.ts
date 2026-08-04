import { describe, it, expect } from "vitest";
import {
  artifactAvailabilityFromLoad,
  artifactParentPath,
  deliverableAvailabilityCaption,
  isArtifactMissingError,
  shouldClaimSavedFile,
  softenSavedFileStatus,
} from "./artifact-availability";
import {
  isFileMissingError,
  previewLoadErrorContent,
} from "./preview-load-error";

describe("isArtifactMissingError", () => {
  it("detects common missing-path messages", () => {
    expect(isArtifactMissingError("File not found: /tmp/a.png")).toBe(true);
    expect(isArtifactMissingError("ENOENT: no such file")).toBe(true);
    expect(isArtifactMissingError("fetch failed: 404")).toBe(true);
    expect(isArtifactMissingError("Unknown asset token")).toBe(true);
    expect(isArtifactMissingError("Path no longer exists")).toBe(true);
  });

  it("does not treat permission errors as missing", () => {
    expect(isArtifactMissingError("EPERM")).toBe(false);
    expect(isArtifactMissingError("Not a previewable file")).toBe(false);
  });
});

describe("artifactAvailabilityFromLoad", () => {
  it("maps ok / missing / error", () => {
    expect(artifactAvailabilityFromLoad({ ok: true })).toBe("available");
    expect(
      artifactAvailabilityFromLoad({
        ok: false,
        errorMessage: "File not found: /x",
      }),
    ).toBe("missing");
    expect(
      artifactAvailabilityFromLoad({
        ok: false,
        errorMessage: "Not a previewable file",
      }),
    ).toBe("error");
  });
});

describe("deliverableAvailabilityCaption", () => {
  it("does not overclaim saved files when missing", () => {
    expect(
      deliverableAvailabilityCaption({
        availability: "missing",
        availableLabel: "Grok wrote this",
        missingLabel: "File unavailable",
        errorLabel: "Could not load",
      }),
    ).toBe("File unavailable");
    expect(shouldClaimSavedFile("missing")).toBe(false);
    expect(shouldClaimSavedFile("available")).toBe(true);
  });
});

describe("softenSavedFileStatus", () => {
  it("does not rewrite when files are present", () => {
    expect(
      softenSavedFileStatus("Saved 1 image/video file(s) under /tmp/a", false),
    ).toBe("Saved 1 image/video file(s) under /tmp/a");
  });

  it("softens Saved claims when files are missing", () => {
    const out = softenSavedFileStatus(
      "Saved 1 image/video file(s) under /tmp/a",
      true,
    );
    expect(out).toMatch(/Produced/i);
    expect(out).toMatch(/no longer on disk/i);
    expect(out).not.toMatch(/^Saved/i);
  });
});

describe("artifactParentPath", () => {
  it("returns parent for absolute paths", () => {
    expect(artifactParentPath("/Users/me/ws/a.png")).toBe("/Users/me/ws");
    expect(artifactParentPath("C:\\ws\\a.png")).toBe("C:/ws");
    expect(artifactParentPath("a.png")).toBeNull();
  });
});

describe("previewLoadErrorContent graceful missing", () => {
  it("uses missing hint and isFileMissingError aligns with artifact helper", () => {
    expect(isFileMissingError("File not found")).toBe(true);
    expect(isArtifactMissingError("File not found")).toBe(true);
    const body = previewLoadErrorContent({
      detail: "File not found: /tmp/x.jpg",
      missingHint: "This file is no longer on disk.",
      genericHint: "Try again.",
    });
    expect(body).toContain("no longer on disk");
    // Primary presentation should include the hint; callers hide raw 500 bodies
    // when isArtifactMissingError is true.
    expect(body).not.toMatch(/500/);
  });
});
