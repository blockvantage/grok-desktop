/**
 * Visible recovery chrome for event history: stale / truncated / retry.
 * Does not blank cached events — only annotates them.
 */
import { useT } from "@/i18n";
import {
  planEventHistoryBanner,
  type EventHistoryStatusInput,
} from "@/lib/event-history-status";
import { cn } from "@/lib/utils";

export function EventHistoryBanner(props: {
  status: EventHistoryStatusInput;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useT();
  const banner = planEventHistoryBanner(props.status);
  if (banner.kind === "none") return null;

  return (
    <div
      role="status"
      data-testid={banner.testId}
      className={cn(
        "mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
        banner.kind === "stale"
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-border/60 bg-muted/40 text-muted-foreground",
        props.className,
      )}
    >
      <span data-testid="event-history-banner-message">
        {t(banner.messageKey)}
      </span>
      {banner.showRetry && props.onRetry ? (
        <button
          type="button"
          data-testid="event-history-retry"
          className="rounded-md border border-current/30 px-2 py-0.5 font-medium hover:bg-background/40"
          onClick={() => props.onRetry?.()}
        >
          {t("workspace.eventsRetry")}
        </button>
      ) : null}
    </div>
  );
}
