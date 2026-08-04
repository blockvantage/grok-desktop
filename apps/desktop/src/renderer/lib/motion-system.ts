/**
 * Phase 5 — centralized motion language for Grok Desk.
 *
 * Functional / subtle only: navigation, palette, intent chips, work graph,
 * completion/artifact reveal, approval/needs-you. Decorative motion stays out.
 * All token classes honor prefers-reduced-motion via globals.css + motion-reduce:*.
 */

/** Canonical durations (ms) — keep in sync with CSS custom properties / Tailwind. */
export const MOTION_DURATION_MS = {
  /** Instant swap when reduced-motion is preferred. */
  instant: 0,
  /** Micro interactions: chip select, stage highlight. */
  micro: 120,
  /** UI chrome: hover, borders, intent chip surface. */
  fast: 150,
  /** Content crossfade (nav content-surface VT). */
  content: 160,
  /** Palette/overlay entrance, stage rail. */
  normal: 200,
  /** Navigation root VT / shell morph. */
  nav: 260,
  /** Completion / artifact reveal, approval park. */
  reveal: 280,
  /** Shared compose morph (Home → workspace). */
  compose: 320,
} as const;

export type MotionDurationKey = keyof typeof MOTION_DURATION_MS;

/** Easing curves — match tailwind `ease-premium` / `ease-spring`. */
export const MOTION_EASING = {
  /** Standard product ease (opacity/transform). */
  premium: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** Slight overshoot for palette entrance only. */
  spring: "cubic-bezier(0.34, 1.3, 0.64, 1)",
  /** Linear for progress-like stage fills. */
  linear: "linear",
} as const;

export type MotionEasingKey = keyof typeof MOTION_EASING;

/**
 * Semantic surfaces that consume the motion language.
 * Values are Tailwind class fragments applied at call sites.
 */
export const MOTION_SURFACE_CLASSES = {
  /** Main content pane VT marker (paired with withViewTransition). */
  navigation: "vt-content motion-nav",
  /** Command palette entrance (cmdk content). */
  palette: "animate-palette-in motion-palette",
  /** Palette overlay dim. */
  paletteOverlay: "data-[state=open]:animate-fade-in motion-palette-overlay",
  /** Composer intent chip select/clear. */
  intentChip:
    "transition-[color,background-color,border-color,box-shadow] duration-150 ease-premium motion-reduce:transition-none motion-intent-chip",
  /** Work graph stage markers and rail container. */
  workGraphStage:
    "transition-[background-color,color,box-shadow,opacity] duration-150 ease-premium motion-reduce:transition-none motion-work-graph-stage",
  workGraphRail:
    "transition-[border-color,background-color,box-shadow] duration-200 ease-premium motion-reduce:transition-none motion-work-graph",
  /** Task completion / artifact list reveal. */
  artifactReveal:
    "motion-artifact-reveal animate-fade-in motion-reduce:animate-none",
  /** Approval / needs-you emphasis: one entrance, then visually stable. */
  approvalNeedsYou:
    "approval-arrive transition-[border-color,background-color,color] duration-200 ease-premium motion-reduce:transition-none motion-approval",
} as const;

export type MotionSurface = keyof typeof MOTION_SURFACE_CLASSES;

/** Surfaces whose CSS/JS animation is nonessential and must skip under reduced motion. */
export const NONESSENTIAL_MOTION_SURFACES: readonly MotionSurface[] = [
  "navigation",
  "palette",
  "paletteOverlay",
  "intentChip",
  "workGraphStage",
  "workGraphRail",
  "artifactReveal",
  "approvalNeedsYou",
] as const;

/**
 * Pure: whether nonessential motion should run.
 * Pass `prefersReduced` from matchMedia or a test double.
 */
export function shouldAnimateMotion(
  prefersReduced: boolean,
  surface?: MotionSurface,
): boolean {
  if (prefersReduced) return false;
  if (surface && !NONESSENTIAL_MOTION_SURFACES.includes(surface)) {
    // Unknown surface: still allow only when motion is not reduced.
    return true;
  }
  return true;
}

/**
 * Resolve duration for a surface. Reduced motion → instant (0).
 */
export function motionDurationMs(
  surface: MotionSurface,
  prefersReduced: boolean,
): number {
  if (prefersReduced || !shouldAnimateMotion(prefersReduced, surface)) {
    return MOTION_DURATION_MS.instant;
  }
  switch (surface) {
    case "navigation":
      return MOTION_DURATION_MS.content;
    case "palette":
    case "paletteOverlay":
      return MOTION_DURATION_MS.normal;
    case "intentChip":
    case "workGraphStage":
      return MOTION_DURATION_MS.fast;
    case "workGraphRail":
    case "approvalNeedsYou":
      return MOTION_DURATION_MS.normal;
    case "artifactReveal":
      return MOTION_DURATION_MS.reveal;
    default:
      return MOTION_DURATION_MS.fast;
  }
}

/**
 * Class list for a surface, optionally stripping animation when reduced.
 * When reduced, return classes that still allow state updates without motion
 * (no animate-*, transition-none).
 */
export function motionClassesFor(
  surface: MotionSurface,
  prefersReduced: boolean,
): string {
  if (prefersReduced) {
    switch (surface) {
      case "navigation":
        return "vt-content";
      case "palette":
        return "motion-palette motion-reduce-static";
      case "paletteOverlay":
        return "motion-palette-overlay motion-reduce-static";
      case "intentChip":
        return "motion-intent-chip motion-reduce:transition-none";
      case "workGraphStage":
        return "motion-work-graph-stage motion-reduce:transition-none";
      case "workGraphRail":
        return "motion-work-graph motion-reduce:transition-none";
      case "artifactReveal":
        return "motion-artifact-reveal";
      case "approvalNeedsYou":
        return "motion-approval motion-reduce:transition-none";
      default:
        return "";
    }
  }
  return MOTION_SURFACE_CLASSES[surface];
}

/** Runtime: read prefers-reduced-motion from the environment. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Class for intent chip given selection state — uses motion tokens.
 * Selection is always reflected in data attributes / colors; only transition is gated.
 */
export function intentChipMotionClass(
  selected: boolean,
  prefersReduced = false,
): string {
  const base = motionClassesFor("intentChip", prefersReduced);
  const selectedTone = selected
    ? "border-primary/50 bg-primary/15 text-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]"
    : "border-white/[0.08] bg-white/[0.04] text-foreground/90 hover:border-primary/35 hover:bg-primary/10";
  return `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${base} ${selectedTone}`;
}

/** Work-graph stage pill classes with motion token. */
export function workGraphStageMotionClass(
  state: "current" | "reached" | "pending",
  needsYou: boolean,
  prefersReduced = false,
): string {
  const base = motionClassesFor("workGraphStage", prefersReduced);
  const tone =
    state === "current"
      ? needsYou
        ? "bg-warning/25 text-warning ring-1 ring-inset ring-warning/40"
        : "bg-ring/20 text-ring ring-1 ring-inset ring-ring/35"
      : state === "reached"
        ? "bg-muted text-foreground/80"
        : "bg-transparent text-muted-foreground";
  return `shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium leading-none ${base} ${tone}`;
}
