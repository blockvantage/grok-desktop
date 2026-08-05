import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOTION_DURATION_MS,
  MOTION_SURFACE_CLASSES,
  NONESSENTIAL_MOTION_SURFACES,
  intentChipMotionClass,
  motionClassesFor,
  motionDurationMs,
  prefersReducedMotion,
  shouldAnimateMotion,
  workGraphStageMotionClass,
} from "./motion-system";
import {
  withViewTransition,
  __resetViewTransitionBusyForTests,
} from "./view-transition";

const rendererRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("motion-system tokens", () => {
  it("defines durations for every major surface language", () => {
    expect(MOTION_DURATION_MS.instant).toBe(0);
    expect(MOTION_DURATION_MS.fast).toBe(150);
    expect(MOTION_DURATION_MS.content).toBe(160);
    expect(MOTION_DURATION_MS.nav).toBe(260);
    expect(MOTION_DURATION_MS.reveal).toBe(280);
    expect(Object.keys(MOTION_SURFACE_CLASSES).sort()).toEqual(
      [
        "approvalNeedsYou",
        "artifactReveal",
        "intentChip",
        "navigation",
        "palette",
        "paletteOverlay",
        "workGraphRail",
        "workGraphStage",
      ].sort(),
    );
    expect(NONESSENTIAL_MOTION_SURFACES.length).toBe(
      Object.keys(MOTION_SURFACE_CLASSES).length,
    );
  });

  it("shouldAnimateMotion is false under reduced motion for all nonessential surfaces", () => {
    for (const surface of NONESSENTIAL_MOTION_SURFACES) {
      expect(shouldAnimateMotion(true, surface)).toBe(false);
      expect(shouldAnimateMotion(false, surface)).toBe(true);
    }
  });

  it("motionDurationMs returns instant when reduced", () => {
    expect(motionDurationMs("navigation", true)).toBe(0);
    expect(motionDurationMs("palette", true)).toBe(0);
    expect(motionDurationMs("intentChip", true)).toBe(0);
    expect(motionDurationMs("artifactReveal", true)).toBe(0);
    expect(motionDurationMs("navigation", false)).toBe(
      MOTION_DURATION_MS.content,
    );
    expect(motionDurationMs("artifactReveal", false)).toBe(
      MOTION_DURATION_MS.reveal,
    );
    expect(motionDurationMs("intentChip", false)).toBe(
      MOTION_DURATION_MS.fast,
    );
  });

  it("motionClassesFor strips animate-* under reduced motion but keeps markers", () => {
    const full = motionClassesFor("artifactReveal", false);
    expect(full).toMatch(/animate-fade-in/);
    const reduced = motionClassesFor("artifactReveal", true);
    expect(reduced).not.toMatch(/animate-fade-in/);
    expect(reduced).toMatch(/motion-artifact-reveal/);

    const paletteFull = motionClassesFor("palette", false);
    expect(paletteFull).toMatch(/animate-palette-in/);
    const paletteReduced = motionClassesFor("palette", true);
    expect(paletteReduced).not.toMatch(/animate-palette-in/);
    expect(paletteReduced).toMatch(/motion-palette/);
  });

  it("uses a one-shot approval entrance instead of perpetual emphasis", () => {
    expect(MOTION_SURFACE_CLASSES.approvalNeedsYou).toMatch(/approval-arrive/);
    expect(MOTION_SURFACE_CLASSES.approvalNeedsYou).not.toMatch(/breathe|pulse/);
  });

  it("intentChipMotionClass always reflects selection; only transition gated", () => {
    const selected = intentChipMotionClass(true, false);
    const unselected = intentChipMotionClass(false, false);
    expect(selected).toMatch(/bg-primary\/15/);
    expect(unselected).not.toMatch(/bg-primary\/15/);
    expect(selected).toMatch(/duration-150|motion-intent-chip/);

    const reducedSelected = intentChipMotionClass(true, true);
    expect(reducedSelected).toMatch(/bg-primary\/15/);
    expect(reducedSelected).toMatch(/motion-reduce:transition-none|motion-intent-chip/);
  });

  it("workGraphStageMotionClass maps current/reached/pending + needsYou", () => {
    const current = workGraphStageMotionClass("current", false, false);
    expect(current).toMatch(/bg-ring\/20/);
    const needsYou = workGraphStageMotionClass("current", true, false);
    expect(needsYou).toMatch(/bg-warning\/25/);
    const pending = workGraphStageMotionClass("pending", false, true);
    expect(pending).toMatch(/motion-work-graph-stage/);
    expect(pending).toMatch(/text-muted-foreground/);
  });
});

describe("prefersReducedMotion + view transition integration", () => {
  beforeEach(() => {
    __resetViewTransitionBusyForTests();
  });

  afterEach(() => {
    __resetViewTransitionBusyForTests();
    vi.unstubAllGlobals();
  });

  it("prefersReducedMotion reads matchMedia", () => {
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
    expect(prefersReducedMotion()).toBe(true);

    const mmOff = (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    });
    vi.stubGlobal("matchMedia", mmOff);
    vi.stubGlobal("window", { matchMedia: mmOff });
    expect(prefersReducedMotion()).toBe(false);
  });

  it("withViewTransition still applies state under reduced motion (no VT)", () => {
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
    vi.stubGlobal("document", { startViewTransition: start });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    // Policy: reduced → zero duration for nav surface
    expect(motionDurationMs("navigation", true)).toBe(0);
  });
});

describe("motion-system structural wiring", () => {
  function read(rel: string): string {
    return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
  }

  it("globals define reduced-motion kill-switch and motion surface hooks", () => {
    const css = read("styles/globals.css");
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms/);
    expect(css).toMatch(/content-surface/);
    expect(css).toMatch(/--motion-duration-fast|--motion-ease-premium|\.motion-intent-chip|\.motion-work-graph/);
  });

  it("major surfaces consume motion tokens (not only ad-hoc durations)", () => {
    const home = read("components/views/home-view.tsx");
    expect(home).toMatch(/intentChipMotionClass|motion-intent-chip|MOTION_SURFACE/);

    const graph = read("components/conversation/work-graph-rail.tsx");
    expect(graph).toMatch(
      /workGraphStageMotionClass|motion-work-graph|MOTION_SURFACE|motionClassesFor/,
    );

    const palette = read("components/command-palette.tsx");
    expect(palette).toMatch(/animate-palette-in|motion-palette|MOTION_SURFACE/);

    const app = read("App.tsx");
    expect(app).toMatch(/withViewTransition/);
    expect(app).toMatch(/MOTION_SURFACE_CLASSES\.navigation|vt-content/);

    const digest = read("components/deliverables-digest.tsx");
    expect(digest).toMatch(/MOTION_SURFACE_CLASSES\.artifactReveal|motion-artifact-reveal/);
  });

  it("keeps the main transcript calm without perpetual loading motion", () => {
    const loader = read("components/conversation-loading.tsx");
    const liveWork = read("components/conversation/live-work-card.tsx");
    const stream = read("components/task-stream.tsx");
    const css = read("styles/globals.css");

    expect(loader).not.toMatch(/conversation-loading-sheen|animate-pulse/);
    expect(liveWork).not.toMatch(/animate-pulse/);
    expect(stream).not.toMatch(/animate-pulse/);
    expect(css).not.toMatch(/animation:\s*(?:thinking-shimmer|think-bounce|conversation-loading-sheen|avatar-working|stream-caret)[^;]*infinite/);
  });
});
