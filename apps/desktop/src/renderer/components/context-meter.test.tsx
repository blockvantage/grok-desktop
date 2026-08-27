import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ContextMeter } from "./context-meter";

describe("ContextMeter", () => {
  it("renders a degraded visible state without contextWindow", () => {
    const html = renderToStaticMarkup(
      <ContextMeter
        usage={{ inputTokens: 1, outputTokens: 1 }}
        onCompact={() => {}}
        compactAvailable
      />,
    );
    expect(html).toContain('data-testid="context-meter"');
    expect(html).toContain('data-context-meter-degraded="true"');
    expect(html).toContain("—");
    expect(html).not.toContain('data-testid="context-meter-summarize"');
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
    expect(html).toContain('data-testid="context-meter-summarize"');
    expect(html).toContain('role="meter"');
  });
});
