import type { WorkerView } from "@/lib/conversation-projector";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

function workerStateKey(status: WorkerView["status"]): string {
  switch (status) {
    case "done":
      return "conversation.workerDone";
    case "failed":
      return "conversation.workerFailed";
    case "cancelled":
      return "conversation.workerCancelled";
    default:
      return "conversation.workerRunning";
  }
}

export function WorkerStrip({
  workers,
  selectedWorkerId = null,
  onSelect,
}: {
  workers: WorkerView[];
  selectedWorkerId?: string | null;
  onSelect?: (workerId: string | null) => void;
}) {
  const t = useT();
  if (workers.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-2" data-worker-strip>
      <span className="shrink-0 text-xs text-muted-foreground">
        {t(
          workers.length === 1
            ? "conversation.workerCountOne"
            : "conversation.workerCountMany",
          { count: workers.length },
        )}
      </span>
      <div
        className="flex min-w-0 gap-1.5 overflow-x-auto"
        aria-label={t("conversation.workerFilterLabel")}
      >
        {workers.map((worker) => {
          const selected = selectedWorkerId === worker.id;
          const activity =
            worker.currentActivity ?? worker.result ?? worker.objective;
          return (
            <button
              key={worker.id}
              type="button"
              className={cn(
                "inline-flex max-w-52 shrink-0 items-start gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-xs transition-colors",
                selected
                  ? "border-foreground/20 bg-foreground/[0.06] text-foreground"
                  : "border-border/70 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
              aria-pressed={selected}
              aria-label={t("conversation.workerFilter", {
                worker: worker.label ?? worker.id,
              })}
              onClick={() => onSelect?.(selected ? null : worker.id)}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  worker.status === "running" && "bg-ring text-ring",
                  worker.status === "done" && "bg-success/70",
                  worker.status !== "running" &&
                    worker.status !== "done" &&
                    "bg-destructive/70",
                )}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block truncate">
                  {worker.label ?? worker.id}
                </span>
                {activity ? (
                  <span
                    className="block truncate text-2xs text-muted-foreground"
                    data-worker-activity
                  >
                    {activity}
                  </span>
                ) : null}
              </span>
              <span className="sr-only">{t(workerStateKey(worker.status))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
