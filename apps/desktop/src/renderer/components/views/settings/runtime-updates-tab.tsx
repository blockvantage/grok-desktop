/**
 * Settings: Runtime & Updates (split from License).
 *
 * Displays safe UpdateStatus from main IPC. Actions: Check, Update and restart,
 * Cancel. Repair/rollback/channel can layer later via the same main handlers.
 */

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { UpdateActionResult, UpdateStatus } from "@grokdesk/shared";
import { PrefRow } from "./pref-row";
import {
  copyDiagnostics,
  openLogsFolder,
} from "@/lib/api";

export type UpdateApi = {
  status: () => Promise<UpdateStatus>;
  check: () => Promise<UpdateActionResult>;
  installRestart: () => Promise<UpdateActionResult>;
  cancel: () => Promise<UpdateActionResult>;
  onStatusChanged?: (cb: (s: UpdateStatus) => void) => () => void;
};

export type RuntimeUpdatesTabProps = {
  /** Inject API for tests; production uses window.grokdesk.update. */
  api?: UpdateApi | null;
  labels?: Partial<RuntimeUpdatesTabLabels>;
  onStatusChange?: (status: UpdateStatus | null) => void;
};

export type RuntimeUpdatesTabLabels = {
  title: string;
  description: string;
  deskVersion: string;
  grokVersion: string;
  target: string;
  channel: string;
  phase: string;
  lastChecked: string;
  security: string;
  check: string;
  checking: string;
  updateRestart: string;
  cancel: string;
  copyDiagnostics: string;
  openLogs: string;
  unavailable: string;
  none: string;
  error: string;
};

const DEFAULT_LABELS: RuntimeUpdatesTabLabels = {
  title: "Runtime & updates",
  description:
    "Managed Grok runtime and Desk updates. Checks use signed manifests; install waits for idle work.",
  deskVersion: "Desk version",
  grokVersion: "Managed Grok",
  target: "Architecture",
  channel: "Channel",
  phase: "Update status",
  lastChecked: "Last checked",
  security: "Security",
  check: "Check for updates",
  checking: "Checking…",
  updateRestart: "Update and restart",
  cancel: "Cancel update",
  copyDiagnostics: "Copy diagnostics",
  openLogs: "Open logs",
  unavailable: "Update service unavailable",
  none: "—",
  error: "Error",
};

/** Resolve preload bridge when wired. */
export function getUpdateApi(): UpdateApi | null {
  if (typeof window === "undefined") return null;
  return window.grokdesk?.update ?? null;
}

function phaseLabel(phase: UpdateStatus["phase"]): string {
  return phase.replace(/_/g, " ");
}

export function RuntimeUpdatesTab(props: RuntimeUpdatesTabProps) {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const api = props.api === undefined ? getUpdateApi() : props.api;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const onStatusChange = props.onStatusChange;
  const applyStatus = useCallback(
    (s: UpdateStatus | null) => {
      setStatus(s);
      onStatusChange?.(s);
    },
    [onStatusChange],
  );

  useEffect(() => {
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
  }, [api, applyStatus]);

  async function runAction(
    fn: () => Promise<UpdateActionResult>,
    okMsg?: string,
  ) {
    if (!api) return;
    setPending(true);
    setActionMsg(null);
    try {
      const r = await fn();
      applyStatus(r.status);
      if (!r.ok) {
        setActionMsg(r.message ?? r.code ?? labels.error);
      } else if (okMsg) {
        setActionMsg(okMsg);
      }
    } catch {
      setActionMsg(labels.error);
    } finally {
      setPending(false);
    }
  }

  const canInstall =
    status?.phase === "staged" || status?.phase === "waiting_for_idle";
  const canCancel =
    status?.phase === "staged" ||
    status?.phase === "waiting_for_idle" ||
    status?.phase === "available" ||
    status?.phase === "downloading" ||
    status?.phase === "verifying";

  return (
    <Card className="border-border/70" data-testid="runtime-updates-tab">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="h-4 w-4 text-primary" />
          {labels.title}
        </CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!api ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="runtime-updates-unavailable"
          >
            {labels.unavailable}
          </p>
        ) : (
          <>
            <div className="rounded-md border px-3 py-2 text-sm">
              <PrefRow
                label={labels.deskVersion}
                value={status?.installed?.deskVersion ?? labels.none}
              />
              <PrefRow
                label={labels.grokVersion}
                value={status?.installed?.grokVersion ?? labels.none}
              />
              <PrefRow
                label={labels.target}
                value={status?.target ?? labels.none}
              />
              <PrefRow
                label={labels.channel}
                value={status?.channel ?? labels.none}
              />
              <div className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
                <span className="text-muted-foreground">{labels.phase}</span>
                <Badge
                  variant="outline"
                  data-testid="runtime-updates-phase"
                  data-phase={status?.phase ?? "unknown"}
                >
                  {status ? phaseLabel(status.phase) : labels.none}
                </Badge>
              </div>
              {status?.available ? (
                <PrefRow
                  label="Available pair"
                  value={`Desk ${status.available.deskVersion} · Grok ${status.available.grokVersion}`}
                />
              ) : null}
              {status?.securityMode && status.securityMode !== "normal" ? (
                <PrefRow
                  label={labels.security}
                  value={status.securityMode.replace(/_/g, " ")}
                />
              ) : null}
              {status?.error ? (
                <p
                  className="mt-2 text-xs text-destructive-text"
                  data-testid="runtime-updates-error"
                >
                  {status.error.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                data-testid="runtime-updates-check"
                disabled={pending}
                onClick={() => void runAction(() => api.check())}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {pending ? labels.checking : labels.check}
              </Button>
              {canInstall ? (
                <Button
                  type="button"
                  size="sm"
                  data-testid="runtime-updates-install"
                  disabled={pending}
                  onClick={() => void runAction(() => api.installRestart())}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {labels.updateRestart}
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="runtime-updates-cancel"
                  disabled={pending}
                  onClick={() => void runAction(() => api.cancel())}
                >
                  {labels.cancel}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="runtime-updates-diagnostics"
                onClick={() => void copyDiagnostics()}
              >
                {labels.copyDiagnostics}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="runtime-updates-logs"
                onClick={() => void openLogsFolder()}
              >
                {labels.openLogs}
              </Button>
            </div>
            {actionMsg ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="runtime-updates-msg"
              >
                {actionMsg}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
