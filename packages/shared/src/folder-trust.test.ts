import { describe, it, expect } from "vitest";
import {
  allowProjectToolSetup,
  isFolderTrusted,
  normalizeTrustPath,
  projectToolsAllowed,
  shouldPromptFolderTrust,
  trustFolder,
  untrustFolder,
} from "./folder-trust.js";

describe("folder-trust (T5)", () => {
  it("normalizes trailing slashes and backslashes", () => {
    expect(normalizeTrustPath("/ws/proj/")).toBe("/ws/proj");
    expect(normalizeTrustPath("C:\\Users\\me\\proj\\")).toBe("c:/Users/me/proj");
  });

  it("trusts exact and nested paths under a trusted root", () => {
    const folders = ["/Users/me/work"];
    expect(isFolderTrusted(folders, "/Users/me/work")).toBe(true);
    expect(isFolderTrusted(folders, "/Users/me/work/repo")).toBe(true);
    expect(isFolderTrusted(folders, "/Users/me/other")).toBe(false);
  });

  it("trustFolder is idempotent", () => {
    const once = trustFolder([], "/ws/a");
    const twice = trustFolder(once, "/ws/a/");
    expect(twice).toEqual(["/ws/a"]);
  });

  it("untrustFolder removes exact path", () => {
    expect(untrustFolder(["/a", "/b"], "/a")).toEqual(["/b"]);
  });

  it("shouldPromptFolderTrust when untrusted and not dismissed", () => {
    expect(
      shouldPromptFolderTrust({
        workspacePath: "/ws",
        trustedFolders: [],
      }),
    ).toBe(true);
    expect(
      shouldPromptFolderTrust({
        workspacePath: "/ws",
        trustedFolders: ["/ws"],
      }),
    ).toBe(false);
    expect(
      shouldPromptFolderTrust({
        workspacePath: "/ws",
        trustedFolders: [],
        dismissedPaths: ["/ws"],
      }),
    ).toBe(false);
  });

  it("projectToolsAllowed only when trusted", () => {
    expect(
      projectToolsAllowed({ workspacePath: "/ws", trustedFolders: [] }),
    ).toBe(false);
    expect(
      projectToolsAllowed({
        workspacePath: "/ws",
        trustedFolders: ["/ws"],
      }),
    ).toBe(true);
  });
});

describe("allowProjectToolSetup (T5 run-start gate)", () => {
  it("fails closed when trustedFolders omitted", () => {
    expect(allowProjectToolSetup({ workspacePath: "/ws" })).toBe(false);
  });

  it("allows when path is trusted", () => {
    expect(
      allowProjectToolSetup({
        workspacePath: "/ws/proj",
        trustedFolders: ["/ws"],
      }),
    ).toBe(true);
  });

  it("denies untrusted path even with non-empty list", () => {
    expect(
      allowProjectToolSetup({
        workspacePath: "/other",
        trustedFolders: ["/ws"],
      }),
    ).toBe(false);
  });
});
