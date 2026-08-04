import { Button } from "@/components/ui/button";
import { t } from "@/i18n/active";

export type ContextUsage = {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
};

/**
 * Thin context-usage meter. Hidden when contextWindow is unknown.
 * Shows a compact chip at ≥70% to trigger ACP compact.
 */
export function ContextMeter(props: {
  usage: ContextUsage | null;
  onCompact: () => void;
  compactAvailable: boolean;
}) {
  const { usage, onCompact, compactAvailable } = props;
  if (!usage?.contextWindow || usage.contextWindow <= 0) return null;
  const used = usage.inputTokens + usage.outputTokens;
  const ratio = Math.min(1, used / usage.contextWindow);
  const pct = Math.round(ratio * 100);
  const showChip = ratio >= 0.7 && compactAvailable;

  return (
    <div
      className="flex items-center gap-2"
      title={t("meter.contextTitle", { pct })}
    >
      <div
        className="h-[3px] w-16 overflow-hidden rounded-full bg-white/10"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("meter.contextUsage")}
      >
        <div
          className="h-full rounded-full bg-ring/80 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showChip && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 text-2xs"
          onClick={onCompact}
        >
          {t("meter.summarizePrompt")}
        </Button>
      )}
    </div>
  );
}
