import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { rpc } from "@/lib/api";

export type DesktopStatusDto = {
  taskId: string;
  active: boolean;
  exclusive: boolean;
  softPaused: boolean;
  lastAction: string | null;
  lastError: string | null;
  frontmostApp: string | null;
  displayId: string | null;
};

export function DesktopControlHud(props: {
  taskId: string;
  onPauseAll?: () => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<DesktopStatusDto | null>(null);

  useEffect(() => {
    const unsub = window.grokdesk?.desktop?.onStatus((s) => {
      const st = s as DesktopStatusDto;
      if (st.taskId === props.taskId) setStatus(st);
    });
    return () => unsub?.();
  }, [props.taskId]);

  if (!status?.active && !status?.exclusive && !status?.softPaused) {
    return null;
  }

  const paused = Boolean(status.softPaused);
  return (
    <div
      className={
        paused
          ? "flex items-center gap-2 rounded-md border border-muted-foreground/25 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
          : "flex items-center gap-2 rounded-md border border-ring/30 bg-ring/10 px-3 py-1.5 text-xs text-ring"
      }
    >
      <span
        className={
          paused
            ? "dot-status bg-muted-foreground/70 text-muted-foreground/70"
            : "dot-status bg-ring text-ring dot-live"
        }
      />
      <span className="font-medium">
        {paused ? t("desktop.hudPaused") : t("desktop.hudActive")}
      </span>
      <span className={paused ? "text-muted-foreground" : "text-ring/90"}>
        {status.frontmostApp || status.lastAction || t("desktop.toggle")}
      </span>
      <div className="ml-auto flex gap-1">
        {status.softPaused ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() =>
              void rpc("desktop.task.resume", { taskId: props.taskId })
            }
          >
            {t("desktop.resume")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => {
              void window.grokdesk?.desktop?.setGlobalPaused(true);
              props.onPauseAll?.();
            }}
          >
            {t("desktop.pause")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() =>
            void rpc("desktop.task.setGrant", {
              taskId: props.taskId,
              granted: false,
            })
          }
        >
          {t("desktop.stop")}
        </Button>
      </div>
    </div>
  );
}
