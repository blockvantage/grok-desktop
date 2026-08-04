import { describe, it, expect, beforeEach } from "vitest";
import {
  clearFolderTrustDismissals,
  dismissFolderTrustPrompt,
  shouldShowFolderTrustPrompt,
  trustFolder,
} from "./folder-trust-ui";

describe("folder-trust-ui", () => {
  beforeEach(() => {
    clearFolderTrustDismissals();
  });

  it("prompts for untrusted workspace", () => {
    expect(
      shouldShowFolderTrustPrompt({
        workspacePath: "/ws",
        trustedFolders: [],
      }),
    ).toBe(true);
  });

  it("stops prompting after trust", () => {
    const trusted = trustFolder([], "/ws");
    expect(
      shouldShowFolderTrustPrompt({
        workspacePath: "/ws",
        trustedFolders: trusted,
      }),
    ).toBe(false);
  });

  it("stops prompting after dismiss for this session", () => {
    dismissFolderTrustPrompt("/ws");
    expect(
      shouldShowFolderTrustPrompt({
        workspacePath: "/ws",
        trustedFolders: [],
      }),
    ).toBe(false);
  });
});
