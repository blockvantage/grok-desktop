import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type {
  WorkflowControlAction,
  WorkflowRunView,
} from "@grokdesk/shared";

export function WorkflowRunPanel(props: {
  view: WorkflowRunView;
  onControl?: (action: WorkflowControlAction) => void;
  controlBusy?: WorkflowControlAction | null;
}) {
  const t = useT();
  const { view } = props;
  const remainingLabel =
    view.agentsUsed != null && view.remaining != null
      ? t("workflow.budgetLine", {
          used: String(view.agentsUsed),
          reserved: String(view.agentsReserved ?? 0),
          remaining: String(view.remaining),
        })
      : null;

  return (
    <section
      className="mt-2 rounded-xl border border-hairline bg-muted/30 px-3 py-2.5"
      data-testid="workflow-run-panel"
      data-workflow-status={view.status}
      data-workflow-handle={view.handle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("workflow.title")}
          </p>
          <p className="mt-0.5 truncate text-sm text-foreground" title={view.objective ?? view.handle}>
            {view.objective ?? view.handle}
          </p>
          {view.currentPhase ? (
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {t("workflow.nowIn", { phase: view.currentPhase })}
            </p>
          ) : null}
        </div>
        {props.onControl && view.status !== "done" ? (
          <div className="flex shrink-0 gap-1">
            {view.status === "paused" ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-2xs"
                disabled={props.controlBusy != null}
                data-testid="workflow-resume"
                onClick={() => props.onControl?.("resume")}
              >
                {t("workflow.resume")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-2xs"
                disabled={props.controlBusy != null}
                data-testid="workflow-pause"
                onClick={() => props.onControl?.("pause")}
              >
                {t("workflow.pause")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-2xs text-destructive-text"
              disabled={props.controlBusy != null}
              data-testid="workflow-stop"
              onClick={() => props.onControl?.("stop")}
            >
              {t("workflow.stop")}
            </Button>
          </div>
        ) : null}
      </div>

      {view.phases.length > 0 ? (
        <ol className="mt-2 flex flex-wrap gap-1.5" data-testid="workflow-phases">
          {view.phases.map((phase) => (
            <li
              key={phase.id}
              data-phase-active={phase.active ? "true" : "false"}
              className={cn(
                "rounded-full border px-2 py-0.5 text-2xs",
                phase.active
                  ? "border-primary/40 bg-primary/15 text-foreground"
                  : "border-hairline text-muted-foreground",
              )}
            >
              {phase.title}
            </li>
          ))}
        </ol>
      ) : null}

      {view.agents.length > 0 ? (
        <ul className="mt-2 space-y-1" data-testid="workflow-agents">
          {view.agents.map((agent) => (
            <li key={agent.id} className="flex items-baseline gap-2 text-2xs">
              <span className="font-medium text-foreground/90">{agent.label}</span>
              {agent.status ? (
                <span className="text-muted-foreground">{agent.status}</span>
              ) : null}
              {agent.summary ? (
                <span className="truncate text-muted-foreground">{agent.summary}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {remainingLabel ? (
        <p className="mt-2 text-2xs text-muted-foreground" data-testid="workflow-budget">
          {remainingLabel}
        </p>
      ) : null}

      {view.pauseMessage ? (
        <p className="mt-1 text-2xs text-warning">{view.pauseMessage}</p>
      ) : null}
    </section>
  );
}
