import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { DictationUiState } from "@/hooks/use-dictation";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

export function DictationButton(props: {
  state: DictationUiState;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  /** 0–1 live level while listening */
  level?: number;
  keepAudio?: boolean;
  onToggleKeepAudio?: () => void;
  /** Localized label for the Keep-audio control */
  keepAudioLabel?: string;
  /** Brief send burst after voice send */
  sending?: boolean;
}) {
  const t = useT();
  const listening =
    props.state === "listening" || props.state === "processing";
  const errored = props.state === "error";
  const level = Math.max(0, Math.min(1, props.level ?? 0));
  const bars = [0.35, 0.7, 1, 0.55, 0.4].map((w, i) => {
    const h = 0.25 + level * w * (0.6 + (i % 3) * 0.15);
    return Math.min(1, h);
  });
  const defaultTitle = listening ? t("dictation.stop") : t("dictation.start");
  const keepLabel = props.keepAudioLabel ?? t("composer.keepAudio");

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant={listening || props.sending ? "default" : "outline"}
        className={cn(
          "relative h-8 w-8 shrink-0 overflow-hidden rounded-full",
          props.state === "listening" && "ring-2 ring-primary/40",
          props.state === "processing" && "opacity-90",
          props.sending && "animate-send-burst",
          errored && "border-destructive/50 text-destructive-text",
        )}
        disabled={props.disabled || props.state === "processing"}
        title={props.title ?? defaultTitle}
        aria-label={props.title ?? defaultTitle}
        onClick={props.onClick}
      >
        {props.state === "listening" ? (
          <span className="flex h-3.5 items-end gap-px" aria-hidden>
            {bars.map((h, i) => (
              <span
                key={i}
                className="w-[2px] rounded-full bg-current transition-[height] duration-75"
                style={{ height: `${Math.round(h * 14)}px` }}
              />
            ))}
          </span>
        ) : props.state === "processing" || props.sending ? (
          <Spinner size="sm" className="border-current border-t-transparent" />
        ) : errored ? (
          <MicOff className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
      </Button>
      {props.onToggleKeepAudio && props.state === "listening" && (
        <button
          type="button"
          className={cn(
            "rounded-full px-1.5 py-0.5 text-2xs font-medium transition-colors",
            props.keepAudio
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
          )}
          title={keepLabel}
          aria-pressed={props.keepAudio}
          onClick={(e) => {
            e.preventDefault();
            props.onToggleKeepAudio?.();
          }}
        >
          {keepLabel}
        </button>
      )}
    </div>
  );
}
