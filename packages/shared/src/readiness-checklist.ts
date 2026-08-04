/**
 * Single readiness checklist when create/run is blocked (I11).
 *
 * Dimensions: Runtime · Sign-in · Workspace — one CTA each.
 * Desk product license is not a readiness dimension (app is free).
 * Pure projector: UI binds to items; no stacked competing banners for the
 * same blocker family.
 */

export type ReadinessDimension = "runtime" | "sign_in" | "workspace";

export type ReadinessItemStatus = "ok" | "blocked" | "warn" | "unknown";

export type ReadinessChecklistItem = {
  id: ReadinessDimension;
  status: ReadinessItemStatus;
  /** i18n key for title (e.g. readiness.runtime.title). */
  titleKey: string;
  /** i18n key for short reason when not ok. */
  reasonKey: string | null;
  /** i18n key for single CTA when blocked/warn. */
  ctaKey: string | null;
  /** Stable action id for the shell (install-runtime, sign-in, …). */
  ctaAction: string | null;
  /** Lower number = show first / higher severity within checklist. */
  order: number;
};

export type ReadinessInput = {
  /** Managed Grok runtime binary available and healthy. */
  runtimeOk: boolean;
  runtimeCode?: string | null;
  /** User signed in to SuperGrok when required (or not required). */
  signInOk: boolean;
  signInRequired?: boolean;
  /** Never-signed-in is not reauth — distinguish for copy. */
  neverSignedIn?: boolean;
  /** Workspace folder chosen and accessible. */
  workspaceOk: boolean;
  workspaceCode?: string | null;
};

const DIMENSION_ORDER: ReadinessDimension[] = [
  "runtime",
  "sign_in",
  "workspace",
];

/**
 * Build the three-dimension readiness checklist.
 * Always returns all rows so the UI can show a complete sheet when blocked.
 */
export function buildReadinessChecklist(
  input: ReadinessInput,
): ReadinessChecklistItem[] {
  const items: ReadinessChecklistItem[] = [
    {
      id: "runtime",
      status: input.runtimeOk ? "ok" : "blocked",
      titleKey: "readiness.runtime.title",
      reasonKey: input.runtimeOk
        ? null
        : input.runtimeCode === "installing"
          ? "readiness.runtime.installing"
          : input.runtimeCode === "update_required"
            ? "readiness.runtime.updateRequired"
            : "readiness.runtime.missing",
      ctaKey: input.runtimeOk
        ? null
        : input.runtimeCode === "installing"
          ? null
          : "readiness.runtime.cta",
      ctaAction:
        input.runtimeOk || input.runtimeCode === "installing"
          ? null
          : "install-runtime",
      order: 0,
    },
    {
      id: "sign_in",
      status: input.signInOk
        ? "ok"
        : input.signInRequired === false
          ? "ok"
          : "blocked",
      titleKey: "readiness.signIn.title",
      reasonKey:
        input.signInOk || input.signInRequired === false
          ? null
          : input.neverSignedIn
            ? "readiness.signIn.never"
            : "readiness.signIn.reauth",
      ctaKey:
        input.signInOk || input.signInRequired === false
          ? null
          : "readiness.signIn.cta",
      ctaAction:
        input.signInOk || input.signInRequired === false ? null : "sign-in",
      order: 1,
    },
    {
      id: "workspace",
      status: input.workspaceOk ? "ok" : "blocked",
      titleKey: "readiness.workspace.title",
      reasonKey: input.workspaceOk
        ? null
        : input.workspaceCode === "inaccessible"
          ? "readiness.workspace.inaccessible"
          : "readiness.workspace.missing",
      ctaKey: input.workspaceOk ? null : "readiness.workspace.cta",
      ctaAction: input.workspaceOk ? null : "choose-workspace",
      order: 2,
    },
  ];

  return items.sort((a, b) => a.order - b.order);
}

/** True when any dimension blocks create/run. */
export function isReadinessBlocked(
  items: readonly ReadinessChecklistItem[],
): boolean {
  return items.some((i) => i.status === "blocked");
}

/** Blocked items only, in dimension order (for compact CTA list). */
export function blockedReadinessItems(
  items: readonly ReadinessChecklistItem[],
): ReadinessChecklistItem[] {
  return items.filter((i) => i.status === "blocked");
}

/** Stable order of dimensions for tests and UI. */
export function readinessDimensionOrder(): readonly ReadinessDimension[] {
  return DIMENSION_ORDER;
}
