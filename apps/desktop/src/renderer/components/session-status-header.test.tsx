import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionStatusSnapshot } from "@grokdesk/shared";
import { SessionStatusHeader } from "./session-status-header";

const emptySnap = (over: Partial<SessionStatusSnapshot> = {}): SessionStatusSnapshot => ({
  schemaVersion: 1,
  modelId: null,
  modelDisplayName: null,
  contextWindowSize: null,
  contextTokens: null,
  usedPercentage: null,
  autoCompactThresholdPercent: null,
  totalCostUsd: null,
  turnStartedAtMs: null,
  branch: null,
  gitWorktree: null,
  effortLevel: null,
  ...over,
});

describe("SessionStatusHeader", () => {
  it("renders em dashes for absent cost and context, never 0", () => {
    const html = renderToStaticMarkup(
      <SessionStatusHeader
        snapshot={emptySnap({ modelDisplayName: "Grok 4.5" })}
        source="acp"
      />,
    );
    expect(html).toContain('data-testid="session-status-header"');
    expect(html).toContain('data-session-status-source="acp"');
    expect(html).toContain("Grok 4.5");
    expect(html).toContain("—");
    expect(html).not.toMatch(/\$0/);
    expect(html).not.toContain(">0%<");
  });
});
