import { describe, it, expect } from "vitest";
import { resolveAppShortcut, isTypingTarget } from "./app-shortcuts";

const base = {
  meta: false,
  shift: false,
  key: "a",
  typing: false,
  paletteOpen: false,
  inboxOpen: false,
  shortcutsOpen: false,
  nav: "home" as const,
  taskSurface: "list" as const,
  showOnboarding: false,
};

describe("resolveAppShortcut", () => {
  it("maps Cmd+N to new_chat", () => {
    expect(
      resolveAppShortcut({ ...base, meta: true, key: "n" }),
    ).toEqual({ type: "new_chat" });
  });

  it("maps Cmd+. to stop_live", () => {
    expect(
      resolveAppShortcut({ ...base, meta: true, key: "." }),
    ).toEqual({ type: "stop_live" });
  });

  it("Escape closes palette before inbox", () => {
    expect(
      resolveAppShortcut({
        ...base,
        key: "Escape",
        paletteOpen: true,
        inboxOpen: true,
      }),
    ).toEqual({ type: "close_palette" });
    expect(
      resolveAppShortcut({
        ...base,
        key: "Escape",
        inboxOpen: true,
      }),
    ).toEqual({ type: "close_inbox" });
  });

  it("Escape leaves workspace to list when not typing", () => {
    expect(
      resolveAppShortcut({
        ...base,
        key: "Escape",
        nav: "tasks",
        taskSurface: "workspace",
      }),
    ).toEqual({ type: "workspace_to_list" });
  });

  it("slash focuses composer on home when not typing", () => {
    expect(resolveAppShortcut({ ...base, key: "/" })).toEqual({
      type: "focus_composer_slash",
    });
    expect(
      resolveAppShortcut({ ...base, key: "/", typing: true }),
    ).toEqual({ type: "none" });
  });

  it("Cmd+Shift+I opens inbox", () => {
    expect(
      resolveAppShortcut({ ...base, meta: true, shift: true, key: "I" }),
    ).toEqual({ type: "open_inbox" });
  });

  it("Cmd+Shift+C copies last response in workspace", () => {
    expect(
      resolveAppShortcut({
        ...base,
        meta: true,
        shift: true,
        key: "c",
        nav: "tasks",
        taskSurface: "workspace",
      }),
    ).toEqual({ type: "copy_last_response" });
    expect(
      resolveAppShortcut({
        ...base,
        meta: true,
        shift: true,
        key: "c",
        nav: "home",
      }),
    ).toEqual({ type: "none" });
  });

  it("Cmd+Shift+P toggles pin in workspace", () => {
    expect(
      resolveAppShortcut({
        ...base,
        meta: true,
        shift: true,
        key: "p",
        nav: "tasks",
        taskSurface: "workspace",
      }),
    ).toEqual({ type: "toggle_pin_chat" });
  });

  it("Cmd+1..6 navigates", () => {
    expect(
      resolveAppShortcut({ ...base, meta: true, key: "3" }),
    ).toEqual({ type: "nav", nav: "scheduled" });
    expect(
      resolveAppShortcut({ ...base, meta: true, key: "6" }),
    ).toEqual({ type: "nav", nav: "settings" });
  });

  it("? opens the shortcuts reference", () => {
    expect(
      resolveAppShortcut({ ...base, shift: true, key: "?" }),
    ).toEqual({ type: "show_shortcuts" });
  });

  it("Cmd+/ opens the shortcuts reference", () => {
    expect(
      resolveAppShortcut({ ...base, meta: true, key: "/" }),
    ).toEqual({ type: "show_shortcuts" });
  });

  it("? does nothing while typing or onboarding", () => {
    expect(
      resolveAppShortcut({ ...base, key: "?", typing: true }),
    ).toEqual({ type: "none" });
    expect(
      resolveAppShortcut({ ...base, key: "?", showOnboarding: true }),
    ).toEqual({ type: "none" });
  });

  it("Escape closes the shortcuts dialog before backing out of the workspace", () => {
    // Regression: with the dialog open, Escape must not also resolve to
    // workspace_to_list and navigate away underneath it.
    expect(
      resolveAppShortcut({
        ...base,
        key: "Escape",
        shortcutsOpen: true,
        nav: "tasks",
        taskSurface: "workspace",
      }),
    ).toEqual({ type: "close_shortcuts" });
  });

  it("open shortcuts dialog owns the keyboard: toggle closes, others are swallowed", () => {
    expect(
      resolveAppShortcut({ ...base, shift: true, key: "?", shortcutsOpen: true }),
    ).toEqual({ type: "close_shortcuts" });
    expect(
      resolveAppShortcut({ ...base, meta: true, key: "/", shortcutsOpen: true }),
    ).toEqual({ type: "close_shortcuts" });
    // Unrelated shortcuts do not fire underneath the modal.
    expect(
      resolveAppShortcut({ ...base, meta: true, key: "n", shortcutsOpen: true }),
    ).toEqual({ type: "none" });
  });
});

describe("isTypingTarget", () => {
  it("detects input, textarea, and contentEditable", () => {
    const asTarget = (v: unknown) => v as EventTarget;
    expect(isTypingTarget(asTarget({ tagName: "INPUT" }))).toBe(true);
    expect(isTypingTarget(asTarget({ tagName: "TEXTAREA" }))).toBe(true);
    expect(
      isTypingTarget(asTarget({ tagName: "DIV", isContentEditable: true })),
    ).toBe(true);
    expect(isTypingTarget(asTarget({ tagName: "DIV" }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
