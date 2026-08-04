import { describe, it, expect } from "vitest";
import {
  initialBrowserUiState,
  reduceBrowserUi,
  isBrowserToolPayload,
  statusShowsBrowserActivity,
} from "./browser-ui";

describe("reduceBrowserUi", () => {
  it("first agent activity opens", () => {
    const s = reduceBrowserUi(initialBrowserUiState(), {
      type: "agent_browser_activity",
    });
    expect(s.open).toBe(true);
    expect(s.keepClosed).toBe(false);
  });

  it("keepClosed blocks auto-open after user collapse", () => {
    let s = initialBrowserUiState();
    s = reduceBrowserUi(s, { type: "agent_browser_activity" });
    s = reduceBrowserUi(s, { type: "user_collapse" });
    expect(s.open).toBe(false);
    expect(s.keepClosed).toBe(true);
    s = reduceBrowserUi(s, { type: "agent_browser_activity" });
    expect(s.open).toBe(false);
  });

  it("toggle re-opens and clears keepClosed", () => {
    let s = initialBrowserUiState();
    s = reduceBrowserUi(s, { type: "user_collapse" });
    s = reduceBrowserUi(s, { type: "user_toggle" });
    expect(s.open).toBe(true);
    expect(s.keepClosed).toBe(false);
  });

  it("toggle from open sets keepClosed", () => {
    let s = reduceBrowserUi(initialBrowserUiState(), {
      type: "agent_browser_activity",
    });
    s = reduceBrowserUi(s, { type: "user_toggle" });
    expect(s.open).toBe(false);
    expect(s.keepClosed).toBe(true);
  });

  it("explicit open clears keep-closed and opens the pane", () => {
    let s = reduceBrowserUi(initialBrowserUiState(), {
      type: "agent_browser_activity",
    });
    s = reduceBrowserUi(s, { type: "user_collapse" });
    expect(s).toMatchObject({ open: false, keepClosed: true });

    s = reduceBrowserUi(s, { type: "user_open" });

    expect(s).toMatchObject({ open: true, keepClosed: false });
  });
});

describe("isBrowserToolPayload", () => {
  it("detects browser_ tools", () => {
    expect(isBrowserToolPayload("browser_open")).toBe(true);
    expect(isBrowserToolPayload("write_file")).toBe(false);
  });
});

describe("statusShowsBrowserActivity", () => {
  it("does not auto-open from load-start before navigation is confirmed", () => {
    expect(
      statusShowsBrowserActivity({
        active: true,
        loading: true,
        url: "",
        lastAction: "browser_open",
      }),
    ).toBe(false);
  });

  it("detects a confirmed host navigation even when the stream has no tool event", () => {
    expect(
      statusShowsBrowserActivity({
        active: true,
        loading: false,
        url: "file:///workspace/panda-site/index.html",
        lastAction: "browser_open",
      }),
    ).toBe(true);
  });

  it("does not auto-open when a load starts over old content and is rejected", () => {
    expect(
      statusShowsBrowserActivity({
        active: true,
        loading: true,
        url: "https://old.example",
        lastAction: "browser_open",
      }),
    ).toBe(false);
    expect(
      statusShowsBrowserActivity({
        active: true,
        loading: false,
        url: "https://old.example",
        lastAction: "browser_open",
        error: "Navigation blocked by policy",
      }),
    ).toBe(false);
  });

  it("keeps a pane visible during loading when the user explicitly opened it", () => {
    let state = reduceBrowserUi(initialBrowserUiState(), {
      type: "user_open",
    });
    const loadingIsConfirmedActivity = statusShowsBrowserActivity({
      active: true,
      loading: true,
      url: "",
      lastAction: "browser_open",
    });
    if (loadingIsConfirmedActivity) {
      state = reduceBrowserUi(state, { type: "agent_browser_activity" });
    }
    expect(state.open).toBe(true);
  });

  it("does not treat an empty ensured view or rejected open as activity", () => {
    expect(
      statusShowsBrowserActivity({
        active: true,
        loading: false,
        url: "",
        lastAction: null,
      }),
    ).toBe(false);
    expect(
      statusShowsBrowserActivity({
        active: true,
        loading: false,
        url: "",
        lastAction: "browser_open",
      }),
    ).toBe(false);
  });
});

describe("streamHasSuccessfulBrowserOpen", () => {
  it("returns false for failed harvest only", async () => {
    const { streamHasSuccessfulBrowserOpen } = await import("./browser-ui");
    expect(
      streamHasSuccessfulBrowserOpen([
        {
          kind: "tool_request",
          payload: { tool: "browser_open" },
        },
        {
          kind: "tool_result",
          payload: { ok: false, output: "Invalid URL" },
        },
      ]),
    ).toBe(false);
  });

  it("returns true for desk-browser success", async () => {
    const { streamHasSuccessfulBrowserOpen } = await import("./browser-ui");
    expect(
      streamHasSuccessfulBrowserOpen([
        {
          kind: "tool_result",
          payload: { ok: true, browserProvider: "desk-browser" },
        },
      ]),
    ).toBe(true);
  });

  it("does not restore from failed or unresolved opens followed by a successful read", async () => {
    const { streamHasSuccessfulBrowserOpen } = await import("./browser-ui");
    expect(
      streamHasSuccessfulBrowserOpen([
        {
          kind: "tool_request",
          payload: { id: "failed-open", tool: "browser_open" },
        },
        {
          kind: "tool_result",
          payload: {
            id: "failed-open",
            tool: "browser_open",
            ok: false,
          },
        },
        {
          kind: "tool_request",
          payload: { id: "unresolved-open", tool: "browser_open" },
        },
        {
          kind: "tool_request",
          payload: { id: "read", tool: "browser_read" },
        },
        {
          kind: "tool_result",
          payload: {
            id: "read",
            tool: "browser_read",
            ok: true,
            browserProvider: "desk-browser",
          },
        },
      ]),
    ).toBe(false);
  });

  it("requires an explicit modern browser result to be browser_open", async () => {
    const { streamHasSuccessfulBrowserOpen } = await import("./browser-ui");
    expect(
      streamHasSuccessfulBrowserOpen([
        {
          kind: "tool_result",
          payload: {
            tool: "browser_click",
            ok: true,
            browserProvider: "desk-browser",
          },
        },
      ]),
    ).toBe(false);
    expect(
      streamHasSuccessfulBrowserOpen([
        {
          kind: "tool_result",
          payload: {
            tool: "browser_read",
            ok: true,
            browserProvider: "desk-browser",
          },
        },
        {
          kind: "tool_result",
          payload: { tool: "browser_open", ok: true },
        },
      ]),
    ).toBe(true);
  });

  it("does not claim success from an unacknowledged request", async () => {
    const { streamHasSuccessfulBrowserOpen } = await import("./browser-ui");
    expect(
      streamHasSuccessfulBrowserOpen([
        {
          kind: "tool_request",
          payload: { tool: "browser_open" },
        },
      ]),
    ).toBe(false);
  });

  it("correlates concurrent success and failure by call id", async () => {
    const { streamHasSuccessfulBrowserOpen } = await import("./browser-ui");
    expect(
      streamHasSuccessfulBrowserOpen([
        {
          kind: "tool_request",
          payload: { id: "failed", tool: "browser_open" },
        },
        {
          kind: "tool_request",
          payload: { id: "opened", tool: "browser_open" },
        },
        {
          kind: "tool_result",
          payload: { id: "failed", tool: "browser_open", ok: false },
        },
        {
          kind: "tool_result",
          payload: {
            id: "opened",
            tool: "browser_open",
            ok: true,
            browserProvider: "desk-browser",
          },
        },
      ]),
    ).toBe(true);
  });
});
