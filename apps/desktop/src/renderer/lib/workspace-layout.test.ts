import { describe, it, expect } from "vitest";
import {
  defaultWorkspaceLayout,
  emptyLayoutStore,
  layoutForConversation,
  setLayoutForConversation,
  shouldRestoreBrowserOpen,
} from "./workspace-layout";

describe("shouldRestoreBrowserOpen", () => {
  it("defaults closed", () => {
    expect(shouldRestoreBrowserOpen(defaultWorkspaceLayout())).toBe(false);
  });

  it("restores when open and not keep-closed", () => {
    expect(
      shouldRestoreBrowserOpen({
        ...defaultWorkspaceLayout(),
        browserOpen: true,
      }),
    ).toBe(true);
  });

  it("keep-closed wins over open", () => {
    expect(
      shouldRestoreBrowserOpen({
        ...defaultWorkspaceLayout(),
        browserOpen: true,
        browserKeepClosed: true,
      }),
    ).toBe(false);
  });

  it("pin restores even if open flag flaky", () => {
    expect(
      shouldRestoreBrowserOpen({
        ...defaultWorkspaceLayout(),
        browserPinned: true,
        browserOpen: false,
      }),
    ).toBe(true);
  });
});

describe("layout store", () => {
  it("returns default for unknown conversation", () => {
    expect(layoutForConversation(emptyLayoutStore(), "x")).toEqual(
      defaultWorkspaceLayout(),
    );
  });

  it("patches per conversation", () => {
    const next = setLayoutForConversation(emptyLayoutStore(), "c1", {
      browserOpen: true,
    });
    expect(layoutForConversation(next, "c1").browserOpen).toBe(true);
    expect(layoutForConversation(next, "c2").browserOpen).toBe(false);
  });

  it("caps stored conversations, evicting least-recently-written first", () => {
    let store = emptyLayoutStore();
    for (let i = 0; i < 350; i++) {
      store = setLayoutForConversation(store, `c${i}`, { browserPinned: true });
    }
    // Cap is 300; the 50 oldest writes are evicted, newest retained.
    expect(Object.keys(store.byConversation).length).toBe(300);
    expect(store.byConversation.c0).toBeUndefined();
    expect(store.byConversation.c49).toBeUndefined();
    expect(store.byConversation.c349?.browserPinned).toBe(true);

    // Re-writing an existing conversation updates in place without growth.
    store = setLayoutForConversation(store, "c50", { filesPanelOpen: true });
    expect(Object.keys(store.byConversation).length).toBe(300);
    expect(layoutForConversation(store, "c50").filesPanelOpen).toBe(true);
  });
});
