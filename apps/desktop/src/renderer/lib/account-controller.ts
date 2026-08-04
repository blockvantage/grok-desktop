/**
 * AccountController — single owner of auth phase, sign-in/out, usage snapshot.
 * Presentational surfaces read from this; they do not start independent polls.
 */

import type { UsageSnapshot } from "@grokdesk/shared";
import {
  initialAccountSnapshot,
  reduceAccount,
  signOutActiveTaskPolicy,
  type AccountEvent,
  type AccountSnapshot,
  type SignInStep,
} from "./account-state";
import {
  SIGN_IN_POLL_ATTEMPTS,
  SIGN_IN_POLL_INTERVAL_MS,
  shouldStopSignInPoll,
} from "./auth-sign-in-poll";

export type AuthStatusPayload = {
  signedIn: boolean;
  needsReauth?: boolean;
  accountLabel: string | null;
  accountName?: string | null;
  engineStatus?: string | null;
  models?: string[] | null;
};

export type AccountControllerDeps = {
  signIn: () => Promise<{ ok: boolean; message?: string }>;
  signOut: () => Promise<{
    ok: boolean;
    signedOut?: boolean;
    message?: string;
  }>;
  status: () => Promise<AuthStatusPayload>;
  getUsage?: (force?: boolean) => Promise<UsageSnapshot | null>;
  pauseAllTasks?: () => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type AccountController = {
  getSnapshot: () => AccountSnapshot;
  getUsageSnapshot: () => UsageSnapshot | null;
  subscribe: (listener: () => void) => () => void;
  /** Apply an account event (gateway status, network, etc.). */
  dispatch: (event: AccountEvent) => void;
  /** Background auth refresh — never blocks boot. */
  refreshStatus: () => Promise<AccountSnapshot>;
  refreshUsage: (force?: boolean) => Promise<UsageSnapshot | null>;
  /**
   * Single-flight sign-in. Concurrent calls join the in-flight promise.
   * Cancel via cancelSignIn().
   */
  startSignIn: () => Promise<{
    ok: boolean;
    cancelled?: boolean;
    accountLabel?: string | null;
  }>;
  cancelSignIn: () => void;
  /**
   * Sign-out with active-task policy. When requireConfirm and active tasks,
   * pass { confirmed: true } after UI confirmation.
   */
  startSignOut: (opts?: {
    activeTaskCount?: number;
    confirmed?: boolean;
  }) => Promise<{
    ok: boolean;
    needsConfirm?: boolean;
    policy?: ReturnType<typeof signOutActiveTaskPolicy>;
    message?: string;
  }>;
};

export function createAccountController(
  deps: AccountControllerDeps,
): AccountController {
  let snapshot = initialAccountSnapshot();
  let usage: UsageSnapshot | null = null;
  const listeners = new Set<() => void>();
  let signInPromise: ReturnType<AccountController["startSignIn"]> | null = null;
  let signInCancelled = false;
  let signOutPromise: ReturnType<AccountController["startSignOut"]> | null =
    null;

  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  function emit() {
    for (const l of listeners) l();
  }

  function dispatch(event: AccountEvent) {
    snapshot = reduceAccount(snapshot, event);
    emit();
  }

  async function refreshStatus(): Promise<AccountSnapshot> {
    try {
      const s = await deps.status();
      dispatch({
        type: "status_resolved",
        signedIn: s.signedIn,
        needsReauth: Boolean(s.needsReauth),
        accountLabel: s.accountLabel,
        accountName: s.accountName,
        engineStatus: s.engineStatus,
        models: s.models,
      });
    } catch (e) {
      dispatch({
        type: "status_failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return snapshot;
  }

  async function refreshUsage(force?: boolean): Promise<UsageSnapshot | null> {
    if (!deps.getUsage) return usage;
    try {
      usage = await deps.getUsage(force);
      emit();
    } catch {
      /* keep prior snapshot */
    }
    return usage;
  }

  function cancelSignIn() {
    if (snapshot.phase === "signing_in") {
      signInCancelled = true;
      dispatch({ type: "sign_in_cancelled" });
    }
  }

  async function startSignIn() {
    if (signInPromise) return signInPromise;
    signInCancelled = false;
    signInPromise = (async () => {
      dispatch({ type: "sign_in_started" });
      try {
        const res = await deps.signIn();
        if (signInCancelled) return { ok: false, cancelled: true };
        if (!res.ok) {
          dispatch({
            type: "sign_in_failed",
            message: res.message ?? "Sign-in failed",
          });
          return { ok: false };
        }
        const steps: SignInStep[] = [
          "opening_browser",
          "waiting_for_supergrok",
          "verifying",
        ];
        for (const step of steps) {
          if (signInCancelled) return { ok: false, cancelled: true };
          dispatch({ type: "sign_in_step", step });
        }
        for (let i = 0; i < SIGN_IN_POLL_ATTEMPTS; i++) {
          if (signInCancelled) return { ok: false, cancelled: true };
          await sleep(SIGN_IN_POLL_INTERVAL_MS);
          if (signInCancelled) return { ok: false, cancelled: true };
          try {
            const s = await deps.status();
            if (shouldStopSignInPoll(s)) {
              dispatch({ type: "sign_in_step", step: "connected" });
              dispatch({
                type: "status_resolved",
                signedIn: true,
                needsReauth: false,
                accountLabel: s.accountLabel,
                accountName: s.accountName,
                engineStatus: s.engineStatus,
                models: s.models,
              });
              void refreshUsage(true);
              return { ok: true, accountLabel: s.accountLabel };
            }
          } catch {
            // keep polling
          }
        }
        dispatch({
          type: "sign_in_failed",
          message: "Login still pending",
        });
        return { ok: false };
      } finally {
        signInPromise = null;
      }
    })();
    return signInPromise;
  }

  async function startSignOut(opts?: {
    activeTaskCount?: number;
    confirmed?: boolean;
  }) {
    if (signOutPromise) return signOutPromise;
    const active = opts?.activeTaskCount ?? 0;
    const policy = signOutActiveTaskPolicy(active);
    if (policy.requiresConfirm && !opts?.confirmed) {
      return { ok: false, needsConfirm: true, policy };
    }

    signOutPromise = (async () => {
      dispatch({ type: "sign_out_started" });
      // Clear usage immediately so surfaces never show prior account data.
      usage = null;
      emit();
      try {
        if (policy.stopsTasks && active > 0 && deps.pauseAllTasks) {
          try {
            await deps.pauseAllTasks();
          } catch {
            /* best effort */
          }
        }
        const res = await deps.signOut();
        dispatch({
          type: "sign_out_finished",
          ok: Boolean(res.ok || res.signedOut),
          signedOut: Boolean(res.signedOut ?? res.ok),
          message: res.message,
        });
        // Verify
        try {
          const s = await deps.status();
          if (!s.signedIn) {
            dispatch({
              type: "status_resolved",
              signedIn: false,
              needsReauth: false,
              accountLabel: null,
              accountName: null,
              models: s.models,
              engineStatus: s.engineStatus,
            });
          }
        } catch {
          /* already signed_out phase */
        }
        return {
          ok: Boolean(res.ok || res.signedOut),
          policy,
          message: res.message,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        dispatch({
          type: "sign_out_finished",
          ok: false,
          signedOut: false,
          message,
        });
        return { ok: false, policy, message };
      } finally {
        signOutPromise = null;
      }
    })();
    return signOutPromise;
  }

  return {
    getSnapshot: () => snapshot,
    getUsageSnapshot: () => usage,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    refreshStatus,
    refreshUsage,
    startSignIn,
    cancelSignIn,
    startSignOut,
  };
}
