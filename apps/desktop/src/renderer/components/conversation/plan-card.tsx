import { useEffect, useRef } from "react";
import { Markdown } from "@/components/ui/markdown-lazy";
import type { TurnPlan } from "@/lib/conversation-projector";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { MOTION_SURFACE_CLASSES } from "@/lib/motion-system";
import { cn } from "@/lib/utils";

export function PlanCard(props: {
  plan: TurnPlan;
  busy?: boolean;
  actionable?: boolean;
  onOpenUrl?: (url: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onRunAnyway: () => void;
}) {
  const t = useT();
  const { plan, busy, onOpenUrl, actionable = true } = props;
  const approveRef = useRef<HTMLButtonElement>(null);
  const awaiting = plan.status === "awaiting_approval";
  const needsUser = awaiting && actionable;
  const approved = plan.status === "approved";
  const statusLabel =
    plan.status === "drafting"
      ? t("conversation.planDrafting")
      : approved
        ? t("conversation.planApproved")
        : t("conversation.planReady");

  // Move keyboard focus to the primary plan action when approval is required.
  useEffect(() => {
    if (!needsUser || busy) return;
    const el = approveRef.current;
    if (!el || typeof el.focus !== "function") return;
    // Defer so the card is in the layout before focusing.
    const id = window.setTimeout(() => {
      try {
        el.focus({ preventScroll: false });
      } catch {
        el.focus();
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [needsUser, busy]);

  return (
    <section
      className={cn(
        "rounded-xl border p-4",
        MOTION_SURFACE_CLASSES.approvalNeedsYou,
        awaiting
          ? "border-warning/40 bg-warning/[0.06]"
          : approved
            ? "border-success/35 bg-success/[0.06]"
            : "border-border bg-card",
      )}
      role="region"
      aria-label={t("conversation.planAriaLabel")}
      aria-busy={Boolean(busy)}
      data-plan-status={plan.status}
      data-plan-actionable={String(needsUser)}
      data-needs-you={needsUser ? "true" : "false"}
    >
      <header
        className={
          awaiting
            ? "mb-2 text-sm font-medium text-warning"
            : approved
              ? "mb-2 text-sm font-medium text-success"
              : "mb-2 text-sm font-medium text-muted-foreground"
        }
      >
        {statusLabel}
      </header>
      <div className="max-h-80 overflow-y-auto">
        <Markdown className="max-w-none text-foreground" onOpenUrl={onOpenUrl}>
          {plan.content}
        </Markdown>
      </div>
      {needsUser && (
        <footer
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label={t("conversation.planApproveStart")}
          data-approval-actions
        >
          <Button
            ref={approveRef}
            type="button"
            size="sm"
            disabled={busy}
            data-approve-action
            data-approval-focus-target
            onClick={props.onApprove}
          >
            {t("conversation.planApproveStart")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={props.onRequestChanges}
          >
            {t("conversation.planRequestChanges")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={props.onRunAnyway}
          >
            {t("conversation.planRunAnyway")}
          </Button>
        </footer>
      )}
    </section>
  );
}
