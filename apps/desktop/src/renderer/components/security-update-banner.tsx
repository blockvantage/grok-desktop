/**
 * Persistent banner when signed security policy is warn or block.
 *
 * Local browse/export stays available; new Grok work is blocked after deadline
 * (gateway enforcement). Renderer cannot set security policy.
 */

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UpdateStatus } from "@grokdesk/shared";
import { getActiveIntlLocale } from "@/i18n/active";
import { useT, type TranslateFn } from "@/i18n";

export type SecurityUpdateBannerProps = {
  status: UpdateStatus | null | undefined;
  onUpdate?: () => void;
  onOpenSettings?: () => void;
  updating?: boolean;
  labels?: Partial<SecurityUpdateBannerLabels>;
};

export type SecurityUpdateBannerLabels = {
  warnTitle: string;
  warnBody: string;
  blockTitle: string;
  blockBody: string;
  update: string;
  settings: string;
};

function defaultLabels(t: TranslateFn): SecurityUpdateBannerLabels {
  return {
    warnTitle: t("securityUpdate.warnTitle"),
    warnBody: t("securityUpdate.warnBody"),
    blockTitle: t("securityUpdate.blockTitle"),
    blockBody: t("securityUpdate.blockBody"),
    update: t("securityUpdate.update"),
    settings: t("securityUpdate.settings"),
  };
}

/** True when status should show the security banner. */
export function shouldShowSecurityUpdateBanner(
  status: UpdateStatus | null | undefined,
): boolean {
  if (!status) return false;
  const mode = status.securityMode;
  if (mode === "security_warn" || mode === "security_block") return true;
  if (status.available?.securityForced) return true;
  return false;
}

export function securityBannerMode(
  status: UpdateStatus | null | undefined,
): "security_warn" | "security_block" | null {
  if (!status) return null;
  if (status.securityMode === "security_block") return "security_block";
  if (status.securityMode === "security_warn") return "security_warn";
  if (status.available?.securityForced) return "security_block";
  return null;
}

export function SecurityUpdateBanner(props: SecurityUpdateBannerProps) {
  // Hook before the early return: banner visibility must not change hook order.
  const t = useT();
  const mode = securityBannerMode(props.status);
  if (!mode) return null;

  // labels prop stays a test-only override on top of the translated defaults.
  const labels = { ...defaultLabels(t), ...props.labels };
  const isBlock = mode === "security_block";
  const title = isBlock ? labels.blockTitle : labels.warnTitle;
  const body = isBlock ? labels.blockBody : labels.warnBody;
  const deadline = props.status?.securityDeadline;
  const deadlineNote =
    deadline && Number.isFinite(Date.parse(deadline))
      ? ` ${t("securityUpdate.deadline", {
          when: new Date(deadline).toLocaleString(getActiveIntlLocale()),
        })}`
      : "";

  return (
    <div
      role="status"
      data-testid="security-update-banner"
      data-security-mode={mode}
      className={
        isBlock
          ? "flex shrink-0 flex-wrap items-center justify-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive-text"
          : "flex shrink-0 flex-wrap items-center justify-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning"
      }
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 text-center sm:text-left">
        <span className="font-medium">{title}</span>
        <span className="mx-1.5 opacity-70" aria-hidden>
          ·
        </span>
        <span className="opacity-90">
          {body}
          {deadlineNote}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {props.onUpdate ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={
              isBlock
                ? "h-7 border-destructive/40 bg-transparent px-2 text-xs text-destructive-text hover:bg-destructive/15"
                : "h-7 border-warning/40 bg-transparent px-2 text-xs text-warning hover:bg-warning/15"
            }
            data-testid="security-update-banner-update"
            disabled={props.updating}
            onClick={props.onUpdate}
          >
            {labels.update}
          </Button>
        ) : null}
        {props.onOpenSettings ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={
              isBlock
                ? "h-7 border-destructive/40 bg-transparent px-2 text-xs text-destructive-text hover:bg-destructive/15"
                : "h-7 border-warning/40 bg-transparent px-2 text-xs text-warning hover:bg-warning/15"
            }
            data-testid="security-update-banner-settings"
            onClick={props.onOpenSettings}
          >
            {labels.settings}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
