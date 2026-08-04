import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ContextMeter } from "./context-meter";

describe("ContextMeter", () => {
  it("renders nothing without contextWindow", () => {
    const html = renderToStaticMarkup(
      <ContextMeter
        usage={{ inputTokens: 1, outputTokens: 1 }}
        onCompact={() => {}}
        compactAvailable
      />,
    );
    expect(html).toBe("");
  });

  it("shows summarize chip at 75% when compact available", () => {
    const onCompact = vi.fn();
    const html = renderToStaticMarkup(
      <ContextMeter
        usage={{
          inputTokens: 180_000,
          outputTokens: 12_000,
          contextWindow: 256_000,
        }}
        onCompact={onCompact}
        compactAvailable
      />,
    );
    expect(html).toContain("summarize so far");
    expect(html).toContain('role="meter"');
  });
});
