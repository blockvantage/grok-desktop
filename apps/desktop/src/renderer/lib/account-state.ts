/**
 * Explicit SuperGrok account state machine for Desk surfaces.
 * Authentication is separate from network, gateway, and engine readiness.
 */

export type AccountPhase =
  | "checking"
  | "signed_out"
  | "signing_in"
  | "signed_in"
  | "reauth_required"
  | "signing_out"
  | "error";

export type NetworkReachability = "unknown" | "online" | "offline";
export type GatewayHealth = "unknown" | "ready" | "starting" | "restarting" | "dead";
export type EngineReadiness =
  | "unknown"
  | "missing"
  | "ready"
  | "needs_auth"
  | "starting";

export type AccountIdentity = {
  accountLabel: string | null;
  accountName: string | null;
};

export type AccountSnapshot = {
  phase: AccountPhase;
  identity: AccountIdentity;
  /** Prior session became invalid — only true in reauth_required. */
  needsReauth: boolean;
  errorMessage: string | null;
  /** Sign-in progress label for UI (not a separate phase). */
  signInStep: SignInStep | null;
  network: NetworkReachability;
  gateway: GatewayHealth;
  engine: EngineReadiness;
  /** Models that require auth; cleared on sign-out. */
  authenticatedModels: string[];
};

export type SignInStep =
  | "opening_browser"
  | "waiting_for_supergrok"
  | "verifying"
  | "connected";

export type AccountEvent =
  | { type: "boot_started" }
  | {
      type: "status_resolved";
      signedIn: boolean;
      needsReauth: boolean;
      accountLabel: string | null;
      accountName?: string | null;
      engineStatus?: EngineReadiness | string | null;
      models?: string[] | null;
    }
  | { type: "status_failed"; message: string }
  | { type: "sign_in_started" }
  | { type: "sign_in_step"; step: SignInStep }
  | { type: "sign_in_cancelled" }
  | { type: "sign_in_failed"; message: string }
  | { type: "sign_out_started" }
  | {
      type: "sign_out_finished";
      ok: boolean;
      signedOut: boolean;
      message?: string;
    }
  | { type: "network"; reachability: NetworkReachability }
  | { type: "gateway"; health: GatewayHealth }
  | { type: "engine"; readiness: EngineReadiness }
  | { type: "models_cleared" }
  | { type: "identity_cleared" };

export function initialAccountSnapshot(
  partial?: Partial<AccountSnapshot>,
): AccountSnapshot {
  return {
    phase: "checking",
    identity: { accountLabel: null, accountName: null },
    needsReauth: false,
    errorMessage: null,
    signInStep: null,
    network: "unknown",
    gateway: "unknown",
    engine: "unknown",
    authenticatedModels: [],
    ...partial,
  };
}

/**
 * Map auth.status probe fields into a stable phase.
 * Never maps never-signed-in to reauth_required.
 */
export function phaseFromAuthStatus(input: {
  signedIn: boolean;
  needsReauth?: boolean;
}): AccountPhase {
  if (input.signedIn) return "signed_in";
  if (input.needsReauth) return "reauth_required";
  return "signed_out";
}

/** Whether shell should show "sign in again" language. */
export function shouldShowReauthBanner(phase: AccountPhase): boolean {
  return phase === "reauth_required";
}

/** Neutral invite for first-time / signed-out users. */
export function shouldShowSignInInvite(phase: AccountPhase): boolean {
  return phase === "signed_out";
}

export function isSignInInFlight(phase: AccountPhase): boolean {
  return phase === "signing_in";
}

export function isSignOutInFlight(phase: AccountPhase): boolean {
  return phase === "signing_out";
}

/**
 * Atomic clear of account-bound UI fields after sign-out.
 */
export function clearAccountBoundState(snapshot: AccountSnapshot): AccountSnapshot {
  return {
    ...snapshot,
    phase: "signed_out",
    identity: { accountLabel: null, accountName: null },
    needsReauth: false,
    errorMessage: null,
    signInStep: null,
    authenticatedModels: [],
    engine: snapshot.engine === "ready" ? "needs_auth" : snapshot.engine,
  };
}

export function reduceAccount(
  state: AccountSnapshot,
  event: AccountEvent,
): AccountSnapshot {
  switch (event.type) {
    case "boot_started":
      return { ...state, phase: "checking", errorMessage: null };

    case "status_resolved": {
      // Successful probe completes an in-flight sign-in.
      if (state.phase === "signing_in" && event.signedIn) {
        return {
          ...state,
          phase: "signed_in",
          needsReauth: false,
          identity: {
            accountLabel: event.accountLabel,
            accountName: event.accountName ?? null,
          },
          errorMessage: null,
          signInStep: null,
          authenticatedModels: event.models?.length
            ? [...event.models]
            : state.authenticatedModels,
          engine: mapEngine(event.engineStatus) ?? state.engine,
        };
      }
      // Do not clobber in-flight sign-in/out with a still-signed-out poll.
      if (state.phase === "signing_in" || state.phase === "signing_out") {
        return {
          ...state,
          identity: {
            accountLabel: event.accountLabel ?? state.identity.accountLabel,
            accountName:
              event.accountName ?? state.identity.accountName,
          },
          authenticatedModels: event.models?.length
            ? [...event.models]
            : state.authenticatedModels,
          engine: mapEngine(event.engineStatus) ?? state.engine,
        };
      }
      const phase = phaseFromAuthStatus({
        signedIn: event.signedIn,
        needsReauth: Boolean(event.needsReauth),
      });
      return {
        ...state,
        phase,
        needsReauth: phase === "reauth_required",
        identity: {
          accountLabel: event.accountLabel,
          accountName: event.accountName ?? null,
        },
        errorMessage: null,
        signInStep: phase === "signed_in" ? null : state.signInStep,
        authenticatedModels: event.models?.length
          ? [...event.models]
          : phase === "signed_in"
            ? state.authenticatedModels
            : [],
        engine: mapEngine(event.engineStatus) ?? state.engine,
      };
    }

    case "status_failed":
      if (state.phase === "signing_in" || state.phase === "signing_out") {
        return { ...state, errorMessage: event.message };
      }
      return {
        ...state,
        phase: "error",
        errorMessage: event.message,
      };

    case "sign_in_started":
      if (state.phase === "signing_in") return state; // dedupe
      return {
        ...state,
        phase: "signing_in",
        signInStep: "opening_browser",
        errorMessage: null,
      };

    case "sign_in_step":
      if (state.phase !== "signing_in") return state;
      return { ...state, signInStep: event.step };

    case "sign_in_cancelled":
      if (state.phase !== "signing_in") return state;
      return {
        ...state,
        phase: state.needsReauth ? "reauth_required" : "signed_out",
        signInStep: null,
        errorMessage: null,
      };

    case "sign_in_failed":
      return {
        ...state,
        phase: state.needsReauth ? "reauth_required" : "error",
        signInStep: null,
        errorMessage: event.message,
      };

    case "sign_out_started":
      return {
        ...state,
        phase: "signing_out",
        errorMessage: null,
      };

    case "sign_out_finished": {
      if (event.ok || event.signedOut) {
        return clearAccountBoundState(state);
      }
      return {
        ...state,
        phase: "error",
        errorMessage: event.message ?? "Sign-out incomplete",
      };
    }

    case "network":
      return { ...state, network: event.reachability };

    case "gateway":
      return { ...state, gateway: event.health };

    case "engine":
      return { ...state, engine: event.readiness };

    case "models_cleared":
      return { ...state, authenticatedModels: [] };

    case "identity_cleared":
      return {
        ...state,
        identity: { accountLabel: null, accountName: null },
        needsReauth: false,
      };

    default:
      return state;
  }
}

function mapEngine(
  status: EngineReadiness | string | null | undefined,
): EngineReadiness | null {
  if (!status) return null;
  if (
    status === "unknown" ||
    status === "missing" ||
    status === "ready" ||
    status === "needs_auth" ||
    status === "starting"
  ) {
    return status;
  }
  return null;
}

/**
 * Policy when signing out while tasks are active.
 * `confirm` — UI must confirm; `block` never used so user can always leave.
 */
export function signOutActiveTaskPolicy(activeTaskCount: number): {
  requiresConfirm: boolean;
  stopsTasks: boolean;
  sharedCliSessionAffected: boolean;
  confirmMessageKey: string;
} {
  return {
    requiresConfirm: activeTaskCount > 0,
    stopsTasks: true,
    sharedCliSessionAffected: true,
    confirmMessageKey:
      activeTaskCount > 0
        ? "account.signOutConfirmActiveTasks"
        : "account.signOutConfirmSharedCli",
  };
}
