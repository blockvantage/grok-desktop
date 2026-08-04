import type { UsageSnapshot } from "@grokdesk/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { usageBarClass, usageTrackClass } from "@/lib/usage-bar";

export function UsageMeter(props: {
  usage: UsageSnapshot | null;
  loading?: boolean;
  onRefresh: () => void;
  onManage: () => void;
}) {
  const t = useT();
  const u = props.usage;
  const pct = u?.creditUsagePercent;
  const bar =
    pct == null ? 0 : Math.max(0, Math.min(100, Math.round(pct)));

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{t("settings.usageTitle")}</div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={props.onRefresh}
            disabled={props.loading}
          >
            {t("settings.usageRefresh")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={props.onManage}
          >
            {t("settings.usageManageBilling")}
          </Button>
        </div>
      </div>
      {!u || !u.rawAvailable ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.usageUnavailable")}
          {u?.subscriptionTier?.startsWith("error:")
            ? ` (${u.subscriptionTier.replace("error:", "")})`
            : ""}
        </p>
      ) : (
        <>
          <div
            className={cn(
              "h-2 overflow-hidden rounded-full transition-colors",
              usageTrackClass(pct),
            )}
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                usageBarClass(pct),
              )}
              style={{ width: `${bar}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {pct != null
              ? t("settings.usagePercent", { pct: Math.round(pct) })
              : t("settings.usageDetail")}
            {u.billingPeriodEnd
              ? ` · → ${u.billingPeriodEnd.slice(0, 10)}`
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
