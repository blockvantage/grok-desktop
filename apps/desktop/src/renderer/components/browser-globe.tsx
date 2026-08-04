import { Globe, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { BrowserGlobeState } from "@/lib/browser-capability";

export function BrowserGlobe({
  active,
  open,
  onToggle,
  capabilityState,
  onPin,
  pinned,
}: {
  active: boolean;
  open: boolean;
  onToggle: () => void;
  /** Truthful capability/globe state beyond open/active. */
  capabilityState?: BrowserGlobeState;
  onPin?: () => void;
  pinned?: boolean;
}) {
  const t = useT();
  const state: BrowserGlobeState =
    capabilityState ??
    (active ? "active" : open ? "ready" : "ready");
  const label = globeLabel(state, t);
  const attention =
    state === "unavailable" ||
    state === "error" ||
    state === "blocked" ||
    state === "degraded";

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              "relative h-8 w-8 shrink-0 px-0 transition-colors duration-150 ease-premium",
              open && "bg-muted text-foreground",
              attention && "text-warning",
              state === "error" && "text-destructive-text",
            )}
            aria-label={label}
            aria-pressed={open}
            onClick={onToggle}
            data-browser-state={state}
            data-pinned={pinned ? "true" : "false"}
          >
            <Globe
              className={cn(
                "h-4 w-4 transition-transform duration-300 ease-premium",
                (active || state === "active" || state === "starting") &&
                  "animate-[spin_12s_linear_infinite]",
                open && "text-primary",
                state === "error" && "text-destructive-text",
                (state === "unavailable" || state === "blocked") &&
                  "opacity-50",
              )}
            />
            {(active || state === "active") && !attention && (
              <span
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-success"
                aria-hidden
              />
            )}
            {attention && (
              <span
                className={cn(
                  "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
                  state === "error" ? "bg-destructive" : "bg-warning",
                )}
                aria-hidden
              />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      {onPin ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-8 w-8 shrink-0 px-0 text-muted-foreground",
                pinned && "text-primary bg-muted",
              )}
              aria-label={
                pinned
                  ? t("workspace.browserUnpin")
                  : t("workspace.browserPin")
              }
              aria-pressed={Boolean(pinned)}
              data-browser-pin
              onClick={onPin}
            >
              {pinned ? (
                <Pin className="h-3.5 w-3.5 fill-current" strokeWidth={1.75} />
              ) : (
                <PinOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {pinned
              ? t("workspace.browserUnpin")
              : t("workspace.browserPin")}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function globeLabel(
  state: BrowserGlobeState,
  t: (key: string) => string,
): string {
  const base = t("workspace.browserPane");
  const key =
    state === "unavailable"
      ? "workspace.browserStateUnavailable"
      : state === "starting"
        ? "workspace.browserStateStarting"
        : state === "degraded"
          ? "workspace.browserStateDegraded"
          : state === "blocked"
            ? "workspace.browserStateBlocked"
            : state === "error"
              ? "workspace.browserStateError"
              : state === "active"
                ? "workspace.browserStateActive"
                : null;
  if (!key) return base;
  return `${base} · ${t(key)}`;
}
