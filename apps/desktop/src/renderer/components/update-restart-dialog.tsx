/**
 * Dialog when an update is staged or waiting for idle.
 *
 * Offers install/restart now, wait for active work, or explicit cancel.
 * Never silently cancels active work.
 */

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { UpdateStatus } from "@grokdesk/shared";
import { useT, type TranslateFn } from "@/i18n";

export type UpdateRestartDialogProps = {
  open: boolean;
  status: UpdateStatus | null | undefined;
  onInstallRestart: () => void;
  onWaitForIdle?: () => void;
  onCancel: () => void;
  onOpenChange?: (open: boolean) => void;
  busy?: boolean;
  labels?: Partial<UpdateRestartDialogLabels>;
};

export type UpdateRestartDialogLabels = {
  title: string;
  body: string;
  waitingBody: string;
  versions: string;
  installRestart: string;
  waitForIdle: string;
  cancel: string;
};

function defaultLabels(t: TranslateFn): UpdateRestartDialogLabels {
  return {
    title: t("updateRestart.title"),
    body: t("updateRestart.body"),
    waitingBody: t("updateRestart.waitingBody"),
    // Raw template: {desk}/{grok} are filled by formatVersions below.
    versions: t("updateRestart.versions"),
    installRestart: t("updateRestart.installRestart"),
    waitForIdle: t("updateRestart.waitForIdle"),
    cancel: t("updateRestart.cancel"),
  };
}

/** Whether the restart dialog should open for this status phase. */
export function shouldShowUpdateRestartDialog(
  status: UpdateStatus | null | undefined,
): boolean {
  if (!status) return false;
  return status.phase === "staged" || status.phase === "waiting_for_idle";
}

function formatVersions(
  template: string,
  status: UpdateStatus | null | undefined,
): string {
  const desk = status?.available?.deskVersion ?? "—";
  const grok = status?.available?.grokVersion ?? "—";
  return template.replace("{desk}", desk).replace("{grok}", grok);
}

/**
 * Presentational panel (no portal) so unit tests and simple hosts can render
 * without Radix Dialog. Shell hosts may wrap this in a modal if desired.
 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function UpdateRestartDialog(props: UpdateRestartDialogProps) {
  // Hook before the `open` early return: visibility must not change hook order.
  const t = useT();
  // Latest props via a ref so the focus effect can key on `open` alone —
  // otherwise callback identity changes would re-run it and steal focus back.
  const propsRef = useRef(props);
  propsRef.current = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // This is a hand-rolled modal (portal-free, for testability), so it does not
  // inherit Radix Dialog's focus management. Provide the essentials: move focus
  // in on open, trap Tab within the dialog, Escape cancels, restore focus out.
  useEffect(() => {
    if (!props.open) return;
    const node = dialogRef.current;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      const p = propsRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        if (!p.busy) {
          p.onCancel();
          p.onOpenChange?.(false);
        }
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreFocusRef.current?.focus?.();
    };
  }, [props.open]);

  if (!props.open) return null;

  // labels prop stays a test-only override on top of the translated defaults.
  const labels = { ...defaultLabels(t), ...props.labels };
  const waiting = props.status?.phase === "waiting_for_idle";
  const body = waiting ? labels.waitingBody : labels.body;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-restart-title"
      data-testid="update-restart-dialog"
      data-update-phase={props.status?.phase ?? "unknown"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[hsl(var(--surface-3))] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_28px_70px_-18px_rgba(0,0,0,0.8)]">
        <div className="space-y-1.5 text-left">
          <h2
            id="update-restart-title"
            className="text-md font-semibold tracking-tight"
          >
            {labels.title}
          </h2>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
        <p
          className="text-sm text-muted-foreground"
          data-testid="update-restart-versions"
        >
          {formatVersions(labels.versions, props.status)}
        </p>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            data-testid="update-restart-install"
            disabled={props.busy}
            onClick={props.onInstallRestart}
          >
            {labels.installRestart}
          </Button>
          {props.onWaitForIdle && !waiting ? (
            <Button
              type="button"
              variant="outline"
              data-testid="update-restart-wait"
              disabled={props.busy}
              onClick={props.onWaitForIdle}
            >
              {labels.waitForIdle}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            data-testid="update-restart-cancel"
            disabled={props.busy}
            onClick={() => {
              props.onCancel();
              props.onOpenChange?.(false);
            }}
          >
            {labels.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
