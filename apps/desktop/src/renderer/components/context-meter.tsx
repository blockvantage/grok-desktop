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
  /** When set, prefer this 0–100 ratio from SessionStatus (ACP). */
  liveRatio?: number | null;
}) {
  const { usage, onCompact, compactAvailable, liveRatio } = props;
  const windowUnknown = !usage?.contextWindow || usage.contextWindow <= 0;
  const ratioFromUsage =
    !windowUnknown && usage
      ? Math.min(1, (usage.inputTokens + usage.outputTokens) / usage.contextWindow!)
      : null;
  const ratio =
    liveRatio != null
      ? Math.min(1, Math.max(0, liveRatio / 100))
      : ratioFromUsage;
  const degraded = ratio == null;
  const pct = degraded ? null : Math.round(ratio * 100);
  const showChip = !degraded && ratio >= 0.7 && compactAvailable;

  return (
    <div
      className="flex items-center gap-2"
      data-testid="context-meter"
      data-context-meter-degraded={degraded ? "true" : undefined}
      title={
        degraded
          ? t("meter.contextUnknown")
          : t("meter.contextTitle", { pct: pct ?? t("meter.unknown") })
      }
    >
      <div
        className="h-[3px] w-16 overflow-hidden rounded-full bg-white/10"
        role="meter"
        aria-valuenow={pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("meter.contextUsage")}
      >
        <div
          className="h-full rounded-full bg-ring/80 transition-[width]"
          style={{ width: degraded ? "0%" : `${pct}%` }}
        />
      </div>
      {showChip && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 text-2xs"
          data-testid="context-meter-summarize"
          onClick={onCompact}
        >
          {t("meter.summarizePrompt")}
        </Button>
      )}
      {degraded ? (
        <span className="text-2xs text-muted-foreground" data-testid="context-meter-unknown">
          {t("meter.unknown")}
        </span>
      ) : null}
    </div>
  );
}
