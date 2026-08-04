import { useEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";
import type { BrowserStatusDto } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

/**
 * Right-hand pane that reports content bounds so main can position the native
 * agent browser view. Chat stays on the left; this fills remaining width.
 */
export function BrowserPaneSlot({
  taskId,
  status,
  onBounds,
  onClose,
  className,
}: {
  taskId: string;
  status: BrowserStatusDto | null;
  onBounds: (
    taskId: string,
    bounds: { x: number; y: number; width: number; height: number } | null,
  ) => void;
  onClose?: () => void;
  className?: string;
}) {
  const t = useT();
  const shellRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const surface = surfaceRef.current;
    const shell = shellRef.current;
    if (!surface) return;

    const report = () => {
      const r = surface.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) {
        onBounds(taskId, null);
        return;
      }
      // Integer DIPs — matches Electron view bounds.
      onBounds(taskId, {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };

    const schedule = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // Second frame after layout (flex split / rail hide) settles.
        rafRef.current = requestAnimationFrame(report);
      });
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(surface);
    if (shell) ro.observe(shell);

    window.addEventListener("resize", schedule);
    // Sidebar collapse / view transitions move the pane without a window resize.
    window.addEventListener("scroll", schedule, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      onBounds(taskId, null);
    };
  }, [taskId, onBounds]);

  // Status chrome height changes → remeasure surface.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const r = surface.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2) {
      onBounds(taskId, {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    }
  }, [
    taskId,
    onBounds,
    status?.url,
    status?.loading,
    status?.error,
    status?.lastAction,
    status?.title,
  ]);

  const urlLabel =
    status?.error ||
    status?.url ||
    (status?.loading ? t("workspace.browserLoading") : t("workspace.browserWaiting"));

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-border/60 bg-background/50",
        className,
      )}
      data-browser-pane
      data-task-id={taskId}
      aria-label={t("workspace.browserPane")}
    >
      <div
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-2.5",
          "bg-black/25 text-2xs text-muted-foreground",
        )}
      >
        <span
          className={cn(
            "dot-status",
            status?.error
              ? "bg-destructive text-destructive"
              : status?.loading
                ? "bg-ring text-ring dot-live"
                : status?.active || status?.url
                  ? "bg-success text-success"
                  : "bg-muted-foreground/50 text-muted-foreground/50",
          )}
          aria-hidden
        />
        {status?.loading && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin opacity-80" />
        )}
        <span
          className="min-w-0 flex-1 truncate font-mono text-2xs"
          title={status?.title ? `${status.title}\n${urlLabel}` : urlLabel}
        >
          {status?.title && !status.error ? (
            <>
              <span className="text-foreground/85">{status.title}</span>
              {status.url ? (
                <span className="text-muted-foreground"> · {status.url}</span>
              ) : null}
            </>
          ) : (
            urlLabel
          )}
        </span>
        {status?.lastAction && !status.error && (
          <span className="hidden shrink-0 tabular-nums opacity-70 sm:inline">
            {status.lastAction.replace(/^browser_/, "")}
          </span>
        )}
        {onClose && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            title={t("workspace.browserClose")}
            aria-label={t("workspace.browserClose")}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        )}
      </div>
      {/* Native WebContentsView is composited over this empty surface */}
      <div
        ref={surfaceRef}
        className="relative min-h-0 min-w-0 flex-1 bg-[hsl(var(--background))]"
        data-browser-surface
      />
    </div>
  );
}
