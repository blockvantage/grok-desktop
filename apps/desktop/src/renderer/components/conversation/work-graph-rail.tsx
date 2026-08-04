/**
 * Compact work-graph rail: Plan → Research → Edit → Review → Deliver.
 * Driven by projectWorkGraph — no invented certainty.
 */

import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import {
  WORK_GRAPH_STAGES,
  type WorkGraphProductState,
  type WorkGraphStage,
  type WorkGraphView,
} from "@/lib/work-graph";
import {
  MOTION_SURFACE_CLASSES,
  workGraphStageMotionClass,
} from "@/lib/motion-system";
import { formatElapsed } from "@/lib/elapsed";
import { useElapsedSeconds } from "@/hooks/use-elapsed";

const STAGE_I18N: Record<WorkGraphStage, string> = {
  plan: "conversation.stagePlan",
  research: "conversation.stageResearch",
  edit: "conversation.stageEdit",
  review: "conversation.stageReview",
  deliver: "conversation.stageDeliver",
};

function productStateClass(state: WorkGraphProductState): string {
  switch (state) {
    case "waiting_for_approval":
      return "border-warning/35 bg-warning/[0.08]";
    case "blocked":
    case "failed":
      return "border-destructive/35 bg-destructive/[0.07]";
    case "retrying":
    case "recovered":
      return "border-ring/30 bg-ring/[0.08]";
    case "done":
      return "border-success/30 bg-success/[0.08]";
    default:
      return "border-ring/25 bg-ring/[0.07]";
  }
}

function titleFor(view: WorkGraphView, t: (k: string) => string): string {
  switch (view.productState) {
    case "waiting_for_approval":
      return t("conversation.waitingApproval");
    case "blocked":
      return t("conversation.blocked");
    case "retrying":
      return t("conversation.retrying");
    case "recovered":
      return t("conversation.recovered");
    case "failed":
      return t("conversation.workerFailed");
    case "done":
      return t("conversation.workerDone");
    default:
      if (view.currentStage) return t(STAGE_I18N[view.currentStage]);
      return t("conversation.working");
  }
}

export function WorkGraphRail({
  view,
  className,
}: {
  view: WorkGraphView;
  className?: string;
}) {
  const t = useT();
  const live =
    view.productState === "working" ||
    view.productState === "retrying" ||
    view.productState === "recovered";
  const elapsedSeconds = useElapsedSeconds(view.elapsedStartIso, live);
  const elapsedLabel = formatElapsed(elapsedSeconds);
  const title = titleFor(view, t);
  const statusLine =
    view.requiredAction ??
    view.statusText ??
    view.detailText;

  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-3",
        MOTION_SURFACE_CLASSES.workGraphRail,
        productStateClass(view.productState),
        view.productState === "waiting_for_approval" &&
          MOTION_SURFACE_CLASSES.approvalNeedsYou,
        className,
      )}
      data-work-graph
      data-product-state={view.productState}
      data-current-stage={view.currentStage ?? "unknown"}
      data-needs-you={view.needsYou ? "true" : "false"}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={t("conversation.workGraphAria")}
    >
      <div className="flex items-center gap-2">
        <p
          className={cn(
            "min-w-0 truncate text-sm font-medium",
            view.needsYou
              ? "text-warning"
              : view.productState === "blocked" ||
                  view.productState === "failed"
                ? "text-destructive-text"
                : "text-ring",
          )}
        >
          {title}
        </p>
        {live && view.elapsedStartIso ? (
          <span
            className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground"
            data-elapsed
            aria-label={elapsedLabel}
          >
            {elapsedLabel}
          </span>
        ) : null}
      </div>

      {statusLine ? (
        <p
          className={cn(
            "mt-0.5 truncate text-xs",
            view.needsYou ? "text-warning/90" : "text-muted-foreground",
          )}
          data-work-graph-status
        >
          {statusLine}
        </p>
      ) : null}

      <ol
        className="mt-2.5 flex min-w-0 items-center gap-1"
        data-work-graph-stages
      >
        {WORK_GRAPH_STAGES.map((stage, i) => {
          const reached = view.stagesReached.includes(stage);
          const current = view.currentStage === stage;
          return (
            <li key={stage} className="flex min-w-0 flex-1 items-center gap-1">
              {i > 0 ? (
                <span
                  className={cn(
                    "h-px min-w-[4px] flex-1",
                    reached || current ? "bg-ring/40" : "bg-border",
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={workGraphStageMotionClass(
                  current ? "current" : reached ? "reached" : "pending",
                  view.needsYou,
                )}
                data-stage={stage}
                data-stage-state={
                  current ? "current" : reached ? "reached" : "pending"
                }
              >
                {t(STAGE_I18N[stage])}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
