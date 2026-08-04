import { describe, expect, it } from "vitest";
import {
  extractLastAssistantMarkdown,
  prepareCopyLastResponse,
} from "./copy-last-response";

describe("copy-last-response", () => {
  it("returns the last assistant block as markdown", () => {
    const md = extractLastAssistantMarkdown([
      { role: "user", text: "plan the launch" },
      { role: "assistant", text: "## Plan\n\n1. Ship\n2. Tell" },
      { role: "user", text: "more detail" },
      { role: "assistant", text: "Detailed plan with **bold**." },
    ]);
    expect(md).toBe("Detailed plan with **bold**.");
  });

  it("skips empty and reports empty intent", () => {
    expect(prepareCopyLastResponse([{ role: "user", text: "hi" }])).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("accepts content field aliases", () => {
    expect(
      extractLastAssistantMarkdown([
        { role: "model", content: "from content field" },
      ]),
    ).toBe("from content field");
  });
});
