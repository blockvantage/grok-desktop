import { describe, it, expect } from "vitest";
import {
  coalesceBrowserToolActivity,
  streamHasBrowserToolActivity,
} from "./browser-activity-from-events";

describe("streamHasBrowserToolActivity", () => {
  const isBrowser = (t: unknown) =>
    typeof t === "string" && t.startsWith("browser_");

  it("returns false when no browser tools", () => {
    expect(
      streamHasBrowserToolActivity(
        [
          { kind: "message", payload: {} },
          { kind: "tool_request", payload: { tool: "shell" } },
        ],
        isBrowser,
      ),
    ).toBe(false);
  });

  it("returns true for browser_open tool_request", () => {
    expect(
      streamHasBrowserToolActivity(
        [{ kind: "tool_request", payload: { tool: "browser_open" } }],
        isBrowser,
      ),
    ).toBe(true);
  });

  it("keeps one semantic row for a browser request/result pair", () => {
    const events = [
      {
        id: "request",
        kind: "tool_request",
        payload: { id: "call-1", tool: "browser_open", url: "https://x.ai" },
      },
      {
        id: "result",
        kind: "tool_result",
        // Legacy host fallback paths sometimes omitted correlation identity.
        payload: {
          tool: "browser_open",
          ok: true,
          browserProvider: "desk-browser",
        },
      },
    ];

    expect(coalesceBrowserToolActivity(events).map((event) => event.id)).toEqual([
      "request",
    ]);
    expect(coalesceBrowserToolActivity(events)[0]?.payload).toMatchObject({
      url: "https://x.ai",
      ok: true,
      browserProvider: "desk-browser",
    });
  });

  it("does not collapse two independent browser actions", () => {
    const events = [
      { id: "open-1", kind: "tool_request", payload: { id: "call-1", tool: "browser_open" } },
      { id: "open-2", kind: "tool_request", payload: { id: "call-2", tool: "browser_open" } },
      { id: "result-1", kind: "tool_result", payload: { id: "call-1", tool: "browser_open" } },
      { id: "result-2", kind: "tool_result", payload: { id: "call-2", tool: "browser_open" } },
    ];

    expect(coalesceBrowserToolActivity(events).map((event) => event.id)).toEqual([
      "open-1",
      "open-2",
    ]);
  });

  it("uses request identity when gateway results omit the tool", () => {
    const events = [
      {
        id: "request-event",
        kind: "tool_request",
        payload: { id: "call-1", tool: "browser_open", url: "https://x.ai" },
      },
      {
        id: "result-event",
        kind: "tool_result",
        payload: { id: "call-1", ok: true, output: "loaded" },
      },
    ];

    const rows = coalesceBrowserToolActivity(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "request-event",
      payload: { tool: "browser_open", ok: true, output: "loaded" },
    });
  });

  it("correlates reversed concurrent completions by call id", () => {
    const events = [
      { id: "req-a", kind: "tool_request", payload: { id: "a", tool: "browser_open", url: "https://a.test" } },
      { id: "req-b", kind: "tool_request", payload: { id: "b", tool: "browser_open", url: "https://b.test" } },
      { id: "res-b", kind: "tool_result", payload: { id: "b", ok: false, output: "B failed" } },
      { id: "res-a", kind: "tool_result", payload: { id: "a", ok: true, output: "A loaded" } },
    ];

    const rows = coalesceBrowserToolActivity(events);
    expect(rows.map((row) => row.id)).toEqual(["req-a", "req-b"]);
    expect(rows[0]?.payload).toMatchObject({ url: "https://a.test", ok: true, output: "A loaded" });
    expect(rows[1]?.payload).toMatchObject({ url: "https://b.test", ok: false, output: "B failed" });
  });

  it("keeps unmatched and ambiguous legacy results independent", () => {
    const events = [
      { id: "req-a", kind: "tool_request", payload: { tool: "browser_open", url: "https://a.test" } },
      { id: "req-b", kind: "tool_request", payload: { tool: "browser_open", url: "https://b.test" } },
      { id: "ambiguous", kind: "tool_result", payload: { tool: "browser_open", ok: true } },
      { id: "unmatched", kind: "tool_result", payload: { id: "missing", ok: false } },
    ];

    expect(coalesceBrowserToolActivity(events).map((event) => event.id)).toEqual([
      "req-a",
      "req-b",
      "ambiguous",
      "unmatched",
    ]);
  });
});
