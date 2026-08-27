/**
 * Right-edge tick rail of conversation turns (Phase 2.3).
 */
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { ConversationTick } from "@/lib/conversation-timeline";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ConversationTimelineRail(props: {
  ticks: ConversationTick[];
  activeTurnId?: string | null;
  onJump: (turnId: string) => void;
}) {
  const t = useT();
  if (props.ticks.length === 0) return null;
  return (
    <TooltipProvider delayDuration={200}>
    <nav
      className="sticky top-6 z-10 ml-2 hidden w-4 shrink-0 flex-col items-center self-start py-1 sm:flex"
      aria-label={t("workspace.timelineRail")}
      data-testid="conversation-timeline-rail"
    >
      <ol className="flex max-h-[min(70vh,28rem)] flex-col items-center gap-1 overflow-y-auto py-1">
        {props.ticks.map((tick) => {
          const active = tick.id === props.activeTurnId;
          return (
            <li key={tick.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-timeline-tick={tick.id}
                    data-timeline-index={tick.index}
                    data-timeline-active={active ? "true" : undefined}
                    aria-label={t("workspace.jumpToTurn", { n: tick.index })}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "block h-2 w-2 rounded-full transition-colors",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      active
                        ? "bg-primary"
                        : tick.hasAnswer
                          ? "bg-foreground/35 hover:bg-foreground/60"
                          : "bg-foreground/20 hover:bg-foreground/45",
                    )}
                    onClick={() => props.onJump(tick.id)}
                  />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[14rem]">
                  {tick.label
                    ? `${t("workspace.jumpToTurn", { n: tick.index })} · ${tick.label}`
                    : t("workspace.jumpToTurn", { n: tick.index })}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </nav>
    </TooltipProvider>
  );
}
