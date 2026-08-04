/**
 * Subscribe to main-owned update status for shell banners and restart UX.
 *
 * Uses preload window.grokdesk.update only (status/check/install/cancel).
 * Renderer cannot set security policy.
 */

import { useCallback, useEffect, useState } from "react";
import type { UpdateActionResult, UpdateStatus } from "@grokdesk/shared";
import type { GrokdeskUpdateBridge } from "@/lib/api";

export type UpdateApi = GrokdeskUpdateBridge;

export type UseUpdateStatusOptions = {
  /** Inject API for tests; production uses window.grokdesk.update. */
  api?: UpdateApi | null;
  /** Auto-fetch status on mount (default true when api available). */
  autoLoad?: boolean;
};

/** Resolve preload bridge when wired. */
export function getUpdateApi(): UpdateApi | null {
  if (typeof window === "undefined") return null;
  return window.grokdesk?.update ?? null;
}

/** Prefer install-restart when a pair is already staged / waiting. */
export function shouldInstallRestartForUpdateNow(
  phase: UpdateStatus["phase"] | null | undefined,
): boolean {
  return phase === "staged" || phase === "waiting_for_idle";
}

export function useUpdateStatus(options: UseUpdateStatusOptions = {}) {
  const api = options.api === undefined ? getUpdateApi() : options.api;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const applyStatus = useCallback((s: UpdateStatus | null) => {
    setStatus(s);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!api) {
      applyStatus(null);
      return null;
    }
    try {
      const next = await api.status();
      applyStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [api, applyStatus]);

  useEffect(() => {
    if (options.autoLoad === false) return;
    if (!api) {
      applyStatus(null);
      return;
    }
    let cancelled = false;
    void api.status().then((s) => {
      if (!cancelled) applyStatus(s);
    });
    const unsub = api.onStatusChanged?.((s) => {
      if (!cancelled) applyStatus(s);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [api, options.autoLoad, applyStatus]);

  const runAction = useCallback(
    async (
      fn: () => Promise<UpdateActionResult>,
    ): Promise<UpdateActionResult | null> => {
      if (!api) return null;
      setPending(true);
      setActionError(null);
      try {
        const r = await fn();
        applyStatus(r.status);
        if (!r.ok) {
          setActionError(r.message ?? r.code ?? "error");
        }
        return r;
      } catch {
        setActionError("error");
        return null;
      } finally {
        setPending(false);
      }
    },
    [api, applyStatus],
  );

  const check = useCallback(
    () => (api ? runAction(() => api.check()) : Promise.resolve(null)),
    [api, runAction],
  );

  const installRestart = useCallback(
    () =>
      api ? runAction(() => api.installRestart()) : Promise.resolve(null),
    [api, runAction],
  );

  const cancel = useCallback(
    () => (api ? runAction(() => api.cancel()) : Promise.resolve(null)),
    [api, runAction],
  );

  /**
   * Banner "Update now": install when staged/waiting, otherwise check/stage.
   */
  const updateNow = useCallback(async () => {
    if (!api) return null;
    if (shouldInstallRestartForUpdateNow(status?.phase)) {
      return installRestart();
    }
    return check();
  }, [api, status?.phase, installRestart, check]);

  return {
    status,
    pending,
    actionError,
    apiAvailable: Boolean(api),
    refreshStatus,
    check,
    installRestart,
    cancel,
    updateNow,
  };
}
