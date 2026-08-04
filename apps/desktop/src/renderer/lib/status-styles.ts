import { cn } from "@/lib/utils";

/**
 * Semantic status pills — desaturated chromatics on dark (Atmos / M3).
 * Avoid neon vibrance that strains eyes on midnight/navy surfaces.
 */
export function taskStatusPillClass(status: string): string {
  switch (status) {
    case "done":
      return "border-transparent bg-success/15 text-success";
    case "running":
    case "queued":
      // Activity = electric/ice (ring token), not approval amber
      return "border-transparent bg-ring/[0.12] text-ring";
    case "waiting_approval":
    case "waiting_user":
      // Approval waiting only — needs-you amber
      return "border-transparent bg-warning/[0.18] text-warning";
    case "failed":
      return "border-transparent bg-destructive/[0.12] text-destructive-text";
    case "cancelled":
    case "blocked":
      return "border-transparent bg-muted text-muted-foreground";
    default:
      return "border-transparent bg-primary/15 text-primary";
  }
}

/**
 * Loud, unmistakable treatment for the ONE active status signal in the
 * workspace header — so "your turn" / "stuck" never reads as ambient "working".
 * Returns null for states that should stay calm (lists keep the quiet pill).
 */
export function taskStatusEmphasisPillClass(status: string): string | null {
  switch (status) {
    case "waiting_user":
    case "waiting_approval":
      return "bg-warning/25 text-warning ring-1 ring-inset ring-warning/50";
    case "blocked":
      return "bg-destructive/20 text-destructive-text ring-1 ring-inset ring-destructive/45";
    default:
      return null;
  }
}

export function statusDotClass(status: string): string {
  return cn(
    "dot-status h-2 w-2",
    status === "done" && "bg-success text-success",
    status === "failed" && "bg-destructive text-destructive",
    // Task 14: only genuinely running dots animate; queued is static.
    status === "running" && "bg-ring text-ring dot-live",
    status === "queued" && "bg-ring text-ring",
    (status === "waiting_approval" || status === "waiting_user") &&
      "bg-warning text-warning",
    status === "cancelled" && "bg-muted-foreground/50 text-muted-foreground/50",
    ![
      "done",
      "failed",
      "running",
      "queued",
      "waiting_approval",
      "waiting_user",
      "cancelled",
    ].includes(status) && "bg-primary text-primary",
  );
}

export function engineOnlineClass(signedIn: boolean, engineStatus?: string | null): string {
  if (signedIn && engineStatus === "ready") return "text-success";
  // Session/runtime needs attention (not "needs approval") — still caution amber
  if (engineStatus === "missing" || engineStatus === "needs_auth")
    return "text-warning";
  return "text-muted-foreground";
}

/** Processing / live activity — electric (ring), never approval amber. */
export function activityToneClass(): string {
  return "text-ring";
}

/** Waiting for user decision — approval amber. */
export function approvalToneClass(): string {
  return "text-warning";
}

/** Completed / approved — success green. */
export function successToneClass(): string {
  return "text-success";
}

/** Destructive / error — danger. */
export function dangerToneClass(): string {
  return "text-destructive-text";
}
