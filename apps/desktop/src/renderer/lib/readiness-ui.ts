/**
 * Desktop binding for I11 readiness checklist (shared projector).
 * Free Desk: no product-license dimension.
 */
import {
  blockedReadinessItems,
  buildReadinessChecklist,
  isReadinessBlocked,
  type ReadinessChecklistItem,
  type ReadinessInput,
} from "@grokdesk/shared";

export type DesktopReadinessInput = ReadinessInput;

export function projectDesktopReadiness(
  input: DesktopReadinessInput,
): {
  items: ReadinessChecklistItem[];
  blocked: boolean;
  blockedItems: ReadinessChecklistItem[];
} {
  const items = buildReadinessChecklist(input);
  return {
    items,
    blocked: isReadinessBlocked(items),
    blockedItems: blockedReadinessItems(items),
  };
}

/**
 * Map common app state into readiness input.
 * Pure — callers supply booleans from auth/runtime hooks.
 *
 * Prefer {@link readinessSignInFlags} so Home/Sidebar/Settings/palette agree
 * on signed-in truth (AccountController phase + auth.signedIn).
 */
export function readinessInputFromAppState(state: {
  runtimeReady: boolean;
  runtimeInstalling?: boolean;
  runtimeUpdateRequired?: boolean;
  signedIn: boolean;
  neverSignedIn?: boolean;
  /** When false, sign-in is not a Run blocker (e.g. still checking, or signed in). */
  signInRequired?: boolean;
  workspaceSelected: boolean;
  workspaceInaccessible?: boolean;
}): DesktopReadinessInput {
  let runtimeCode: string | null = null;
  if (!state.runtimeReady) {
    runtimeCode = state.runtimeInstalling
      ? "installing"
      : state.runtimeUpdateRequired
        ? "update_required"
        : "missing";
  }
  // signInRequired defaults true only when caller did not pass it; callers
  // that use readinessSignInFlags pass an explicit value so boot "checking"
  // never false-blocks with a Sign-in CTA.
  const signInRequired = state.signInRequired !== false;
  return {
    runtimeOk: state.runtimeReady,
    runtimeCode,
    signInOk: state.signedIn,
    signInRequired,
    neverSignedIn: state.neverSignedIn,
    workspaceOk: state.workspaceSelected && !state.workspaceInaccessible,
    workspaceCode: state.workspaceInaccessible
      ? "inaccessible"
      : state.workspaceSelected
        ? null
        : "missing",
  };
}
