import { describe, it, expect, vi } from "vitest";
import { GROK_BUILD_DOCS_URL, openDocsWindow } from "./docs-url";

describe("openDocsWindow", () => {
  it("opens xAI build docs with noopener", () => {
    const open = vi.fn();
    openDocsWindow(open as typeof window.open);
    expect(open).toHaveBeenCalledWith(
      GROK_BUILD_DOCS_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });
});
