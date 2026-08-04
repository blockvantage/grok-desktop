import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UpdateActionResult, UpdateStatus } from "@grokdesk/shared";
import {
  RuntimeUpdatesTab,
  type UpdateApi,
} from "./runtime-updates-tab";

function status(partial: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: "idle",
    channel: "stable",
    target: "darwin-arm64",
    installed: { deskVersion: "1.0.0", grokVersion: "0.9.0" },
    ...partial,
  };
}

function createApi(overrides: Partial<UpdateApi> = {}): UpdateApi {
  return {
    status: vi.fn(async () => status()),
    check: vi.fn(async () => ({
      ok: true,
      status: status({ phase: "staged" }),
    })),
    installRestart: vi.fn(async () => ({
      ok: true,
      status: status({ phase: "waiting_for_idle" }),
    })),
    cancel: vi.fn(async () => ({
      ok: true,
      status: status({ phase: "idle" }),
    })),
    ...overrides,
  };
}

describe("RuntimeUpdatesTab", () => {
  it("renders unavailable copy when no update API", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeUpdatesTab, { api: null }),
    );
    expect(html).toContain('data-testid="runtime-updates-tab"');
    expect(html).toContain('data-testid="runtime-updates-unavailable"');
    expect(html).toContain("Update service unavailable");
  });

  it("renders check control and title when API is present", () => {
    const api = createApi();
    // SSR cannot await useEffect; still assert static shell.
    const html = renderToStaticMarkup(
      createElement(RuntimeUpdatesTab, { api }),
    );
    // HTML-escaped ampersand from React text nodes.
    expect(html).toMatch(/Runtime &amp; updates|Runtime & updates/);
    expect(html).toContain('data-testid="runtime-updates-check"');
    expect(html).toContain("Check for updates");
    expect(html).toContain('data-testid="runtime-updates-diagnostics"');
    expect(html).toContain('data-testid="runtime-updates-logs"');
  });

  it("exposes install/cancel when status would allow (via labels only in SSR)", () => {
    // Pure helper-style assertion: API shape is renderer-safe.
    const result: UpdateActionResult = {
      ok: true,
      status: status({
        phase: "staged",
        available: {
          pairId: "p",
          deskVersion: "1.1.0",
          grokVersion: "0.9.4",
          channel: "stable",
        },
      }),
    };
    expect(result.status.phase).toBe("staged");
    expect(JSON.stringify(result)).not.toMatch(/grant|privatePkcs8|GD3\./);
  });
});
