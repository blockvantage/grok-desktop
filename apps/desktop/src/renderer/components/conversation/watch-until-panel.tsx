import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import type { WatchUntilView } from "@grokdesk/shared";
import { watchUntilStopPrompt } from "@grokdesk/shared";

export function WatchUntilPanel(props: {
  view: WatchUntilView;
  onStop?: () => void;
}) {
  const t = useT();
  const { view } = props;
  return (
    <section
      className="mt-2 rounded-xl border border-hairline bg-muted/30 px-3 py-2.5"
      data-testid="watch-until-panel"
      data-watch-status={view.status}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("watch.title")}
          </p>
          <p
            className="mt-0.5 truncate text-sm text-foreground"
            title={view.description}
          >
            {view.description}
          </p>
          {view.lastLine ? (
            <p className="mt-0.5 truncate text-2xs text-muted-foreground">
              {view.lastLine}
            </p>
          ) : (
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {t(`watch.status.${view.status}`)}
            </p>
          )}
        </div>
        {props.onStop && view.status === "running" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-2xs"
            data-testid="watch-until-stop"
            onClick={() => props.onStop?.()}
          >
            {t("watch.stop")}
          </Button>
        ) : null}
      </div>
      <span className="sr-only">{watchUntilStopPrompt(view)}</span>
    </section>
  );
}
