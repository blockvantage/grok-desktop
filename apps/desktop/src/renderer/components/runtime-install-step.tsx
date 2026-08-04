/**
 * Optional first-run step: install managed Grok runtime progress.
 * Used by onboarding when no complete managed runtime is present yet.
 */

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UpdateStatus } from "@grokdesk/shared";
import { useT, type TranslateFn } from "@/i18n";

export type RuntimeInstallStepProps = {
  status?: UpdateStatus | null;
  onCheck?: () => void;
  onContinue?: () => void;
  onSkip?: () => void;
  pending?: boolean;
  labels?: Partial<RuntimeInstallStepLabels>;
};

export type RuntimeInstallStepLabels = {
  title: string;
  body: string;
  installing: string;
  ready: string;
  check: string;
  continue: string;
  skip: string;
};

function defaultLabels(t: TranslateFn): RuntimeInstallStepLabels {
  return {
    title: t("runtimeInstall.title"),
    body: t("runtimeInstall.body"),
    installing: t("runtimeInstall.installing"),
    ready: t("runtimeInstall.ready"),
    check: t("runtimeInstall.check"),
    continue: t("runtimeInstall.continue"),
    skip: t("runtimeInstall.skip"),
  };
}

export function RuntimeInstallStep(props: RuntimeInstallStepProps) {
  const t = useT();
  // labels prop stays a test-only override on top of the translated defaults.
  const labels = { ...defaultLabels(t), ...props.labels };
  const phase = props.status?.phase ?? "idle";
  const ready =
    Boolean(props.status?.installed?.grokVersion) &&
    (phase === "idle" || phase === "committed");
  const busy =
    props.pending ||
    phase === "downloading" ||
    phase === "verifying" ||
    phase === "installing" ||
    phase === "checking";

  return (
    <div
      className="space-y-4 rounded-2xl border border-hairline bg-white/[0.03] p-5"
      data-testid="runtime-install-step"
      data-phase={phase}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/[0.12] text-primary"
          aria-hidden
        >
          <Download className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            {labels.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{labels.body}</p>
        </div>
      </div>
      <p
        className={
          ready
            ? "text-sm text-success"
            : busy
              ? "text-sm text-ring"
              : "text-sm text-muted-foreground"
        }
        data-testid="runtime-install-status"
      >
        {busy ? labels.installing : ready ? labels.ready : labels.body}
      </p>
      {props.status?.installed ? (
        <p className="text-xs text-muted-foreground">
          Desk {props.status.installed.deskVersion} · Grok{" "}
          {props.status.installed.grokVersion}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!ready && props.onCheck ? (
          <Button
            type="button"
            data-testid="runtime-install-check"
            disabled={busy}
            onClick={props.onCheck}
          >
            {labels.check}
          </Button>
        ) : null}
        {ready && props.onContinue ? (
          <Button
            type="button"
            data-testid="runtime-install-continue"
            onClick={props.onContinue}
          >
            {labels.continue}
          </Button>
        ) : null}
        {props.onSkip ? (
          <Button
            type="button"
            variant="ghost"
            data-testid="runtime-install-skip"
            onClick={props.onSkip}
          >
            {labels.skip}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
