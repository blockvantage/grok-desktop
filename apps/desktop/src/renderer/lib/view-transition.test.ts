import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  withViewTransition,
  __resetViewTransitionBusyForTests,
} from "./view-transition";

type FakeDoc = {
  startViewTransition?: (cb: () => void) => { finished?: Promise<void> };
};

function installDocument(fake: FakeDoc) {
  vi.stubGlobal("document", fake);
}

describe("withViewTransition", () => {
  beforeEach(() => {
    __resetViewTransitionBusyForTests();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));
  });

  afterEach(() => {
    __resetViewTransitionBusyForTests();
    vi.unstubAllGlobals();
  });

  it("always runs update when View Transitions API is missing", () => {
    installDocument({});
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("runs update inside startViewTransition when available", () => {
    const finished = Promise.resolve();
    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished };
    });
    installDocument({ startViewTransition: start });
    const update = vi.fn();
    withViewTransition(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("still applies update when a transition is already busy (no dropped state)", async () => {
    let resolveFirst!: () => void;
    const firstFinished = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const start = vi.fn((cb: () => void) => {
      cb();
      if (start.mock.calls.length === 1) {
        return { finished: firstFinished };
      }
      return { finished: Promise.resolve() };
    });
    installDocument({ startViewTransition: start });

    const a = vi.fn();
    const b = vi.fn();
    withViewTransition(a);
    withViewTransition(b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    // Second call while busy should not stack another transition.
    expect(start).toHaveBeenCalledTimes(1);

    resolveFirst();
    await firstFinished;
    await Promise.resolve();
    __resetViewTransitionBusyForTests();

    const c = vi.fn();
    withViewTransition(c);
    expect(c).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("does not double-apply update if startViewTransition throws after callback", () => {
    const start = vi.fn((cb: () => void) => {
      cb();
      throw new Error("vt failed after capture");
    });
    installDocument({ startViewTransition: start });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("applies update once if startViewTransition throws before callback", () => {
    const start = vi.fn(() => {
      throw new Error("vt failed before capture");
    });
    installDocument({ startViewTransition: start });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skips animation when reduced motion is preferred but still updates", () => {
    const mm = (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    });
    vi.stubGlobal("matchMedia", mm);
    vi.stubGlobal("window", { matchMedia: mm });
    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    installDocument({ startViewTransition: start });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });
});

