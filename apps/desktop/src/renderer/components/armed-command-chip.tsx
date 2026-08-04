import { Sparkles, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact truth surface when a fill slash command is armed in the composer.
 * Fully opaque (no backdrop-blur) — sits inside the composer surface.
 */
export function ArmedCommandChip(props: {
  label: string;
  effect: string;
  escalates: boolean;
  onClear: () => void;
  clearLabel: string;
  expandsHint?: string;
}) {
  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-2 rounded-lg border border-white/[0.1]",
        "bg-[hsl(var(--surface-3))] px-2.5 py-1.5 text-xs",
      )}
      title={props.expandsHint}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">{props.label}</span>
          {props.escalates ? (
            <Zap
              className="h-3 w-3 shrink-0 text-warning"
              aria-hidden
            />
          ) : null}
        </div>
        <div className="truncate text-2xs text-muted-foreground">
          {props.effect}
        </div>
      </div>
      <button
        type="button"
        onClick={props.onClear}
        aria-label={props.clearLabel}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Strip a leading `/token` (and one following space) so args remain as plain text. */
export function stripArmedSlashPrefix(text: string, token: string): string {
  const prefix = `/${token}`;
  if (!text.toLowerCase().startsWith(prefix.toLowerCase())) return text;
  let rest = text.slice(prefix.length);
  if (rest.startsWith(" ") || rest.startsWith("\n") || rest.startsWith("\t")) {
    rest = rest.slice(1);
  }
  return rest;
}
