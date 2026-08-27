import {
  SESSION_STATUS_ABSENT,
  projectSessionStatusHeader,
  type SessionStatusSnapshot,
} from "@grokdesk/shared";
import { t } from "@/i18n/active";

export function SessionStatusHeader(props: {
  snapshot: SessionStatusSnapshot | null;
  nowMs?: number;
  source: "acp" | "headless";
}) {
  const view = projectSessionStatusHeader(props.snapshot, props.nowMs);
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground"
      data-testid="session-status-header"
      data-session-status-source={props.source}
    >
      <span data-session-status-model title={t("meter.model")}>
        {view.model}
      </span>
      <span aria-hidden="true">·</span>
      <span data-session-status-context title={t("meter.contextUsage")}>
        {view.context}
      </span>
      <span aria-hidden="true">·</span>
      <span data-session-status-cost title={t("meter.cost")}>
        {view.cost}
      </span>
      <span aria-hidden="true">·</span>
      <span data-session-status-timer title={t("meter.timer")}>
        {view.turnTimer}
      </span>
      {view.branch !== SESSION_STATUS_ABSENT ? (
        <>
          <span aria-hidden="true">·</span>
          <span data-session-status-branch title={t("meter.branch")}>
            {view.branch}
          </span>
        </>
      ) : null}
      {view.worktree !== SESSION_STATUS_ABSENT ? (
        <>
          <span aria-hidden="true">·</span>
          <span data-session-status-worktree title={t("meter.worktree")}>
            {view.worktree}
          </span>
        </>
      ) : null}
    </div>
  );
}
