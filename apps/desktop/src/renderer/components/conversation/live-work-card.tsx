import type {
  PrimaryRunView,
  WorkerView,
  WorkEntry,
} from "@/lib/conversation-projector";
import { useT } from "@/i18n";
import { formatElapsed } from "@/lib/elapsed";
import { useElapsedSeconds } from "@/hooks/use-elapsed";
import {
  openToolsFromWork,
  runningMediaKind,
  type MediaToolKind,
} from "@/lib/media-progress";
import { projectWorkGraph, type WorkGraphEventLike } from "@/lib/work-graph";
import { WorkGraphRail } from "./work-graph-rail";

export function LiveWorkCard({
  run,
  workers,
  work = [],
  activityCaption,
  events = [],
}: {
  run: PrimaryRunView;
  workers: WorkerView[];
  /** Conversation work log — used for media tool detection (PROG-2). */
  work?: WorkEntry[];
  /** Optional run_progress / live summary caption (PROG-3). */
  activityCaption?: string | null;
  /** Source events for work-graph stage mapping (Phase 4). */
  events?: readonly WorkGraphEventLike[];
}) {
  const t = useT();
  const running = run.state === "running";
  // primaryRun.startedAt is task.createdAt (attempt start not on Task payload).
  const elapsedSeconds = useElapsedSeconds(run.startedAt, running);
  const mediaKind: MediaToolKind | null = running
    ? runningMediaKind(openToolsFromWork(work))
    : null;
  const elapsedLabel = formatElapsed(elapsedSeconds);

  // PROG-2: media card replaces the calm working card (exactly one live signal).
  if (mediaKind && running) {
    const copyKey =
      mediaKind === "video"
        ? "progress.renderingVideo"
        : "progress.renderingImage";
    return (
      <div
        className="rounded-xl border border-ring/25 bg-ring/[0.07] px-3.5 py-3"
        data-live-work-card
        data-media-progress={mediaKind}
        aria-live="polite"
        aria-atomic="true"
      >
        <div
          className="aspect-video w-full overflow-hidden rounded-lg border border-white/[0.06] bg-muted/40"
          aria-hidden="true"
        >
          <div className="h-full w-full bg-gradient-to-br from-ring/15 via-muted/35 to-muted/65" />
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-ring">
            {t(copyKey)}
          </p>
          <span
            className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground"
            data-elapsed
            aria-label={elapsedLabel}
          >
            {elapsedLabel}
          </span>
        </div>
      </div>
    );
  }

  // Build event-like feed from work entries + optional raw events.
  const graphEvents: WorkGraphEventLike[] =
    events.length > 0
      ? [...events]
      : work.map((w) => ({
          kind: w.kind,
          payload: w.payload,
          createdAt: w.timestamp,
        }));

  // Include worker activity as synthetic stage signals when no raw events.
  if (events.length === 0) {
    for (const worker of workers) {
      if (worker.status === "running" && worker.currentActivity) {
        graphEvents.push({
          kind: "worker_activity",
          payload: {
            workerId: worker.id,
            label: worker.label,
            objective: worker.objective,
            summary: worker.currentActivity,
          },
        });
      }
    }
  }

  const graph = projectWorkGraph({
    events: graphEvents,
    task: {
      status: run.state,
      createdAt: run.startedAt,
      completedAt: run.completedAt,
    },
    statusOverride: run.state,
  });

  // Prefer live activity caption when it adds detail beyond the graph status.
  const caption = activityCaption?.trim();
  const merged =
    caption && caption !== graph.statusText
      ? {
          ...graph,
          statusText: graph.needsYou
            ? graph.requiredAction ?? graph.statusText
            : caption,
        }
      : graph;

  return (
    <div data-live-work-card data-run-state={run.state}>
      <WorkGraphRail view={merged} />
    </div>
  );
}
