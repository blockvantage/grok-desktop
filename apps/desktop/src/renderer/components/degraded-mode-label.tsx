/**
 * I6: single limited-mode label for the open run (not per-tool spam).
 */
import { useT } from "@/i18n";
import type { DegradedModeView } from "@/lib/degraded-mode-ui";
import { cn } from "@/lib/utils";

export function DegradedModeLabel(props: {
  view: DegradedModeView;
  className?: string;
}) {
  const t = useT();
  if (!props.view.showLimitedLabel) return null;
  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground",
        props.className,
      )}
      role="status"
      data-testid="degraded-mode-label"
      data-transport={props.view.transport}
    >
      <span className="font-medium text-foreground">
        {t(props.view.labelKey)}
      </span>
      {props.view.detailKey ? (
        <span className="ml-1.5 opacity-90">{t(props.view.detailKey)}</span>
      ) : null}
    </div>
  );
}
