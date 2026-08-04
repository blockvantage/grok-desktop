/**
 * I11: single readiness checklist when create/run is blocked.
 * Runtime / Sign-in / Workspace - one CTA each (free Desk; no license row).
 */
import type { ReadinessChecklistItem } from "@grokdesk/shared";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HOME_MIN_CONTENT_WIDTH_BUDGET,
  readinessCtaFitsMinWidth,
  readinessLayoutMode,
} from "@/lib/readiness-layout";

export function ReadinessChecklist(props: {
  items: readonly ReadinessChecklistItem[];
  onAction?: (action: string) => void;
  className?: string;
  /**
   * Content column width for layout mode (stack vs inline).
   * Defaults to the app min-window content budget (~960 chrome-subtracted).
   * Tests pass explicit widths (e.g. 400 stack, 872 min-window).
   */
  contentWidth?: number;
}) {
  const t = useT();
  const blocked = props.items.filter((i) => i.status === "blocked");
  if (blocked.length === 0) return null;

  const contentWidth = props.contentWidth ?? HOME_MIN_CONTENT_WIDTH_BUDGET;
  const layoutMode = readinessLayoutMode(contentWidth);
  // Primary CTA must fit the content budget (wrap under label if needed).
  const primaryCtaFits = readinessCtaFitsMinWidth({
    contentWidth,
    labelWidth: 220,
    ctaWidth: 168,
  });
  const primaryBlocked = blocked[0];
  const stack = layoutMode === "stack";

  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-x-hidden rounded-xl border border-warning/40 bg-warning/5 p-3 sm:p-4 space-y-3",
        props.className,
      )}
      role="region"
      aria-label={t("readiness.title")}
      data-testid="readiness-checklist"
      data-layout-mode={layoutMode}
      data-cta-fits={primaryCtaFits ? "true" : "false"}
      data-content-width={String(contentWidth)}
    >
      <p className="text-sm font-medium text-foreground">{t("readiness.title")}</p>
      <ul className="space-y-2">
        {props.items.map((item) => {
          const ok = item.status === "ok";
          const blockedItem = item.status === "blocked";
          // Stack (narrow): primary CTA full-width under label.
          // Inline: only the first blocked row keeps an inline CTA; others
          // collapse into the secondary row so 960×640 never clips.
          const showInlineCta =
            Boolean(item.ctaKey && item.ctaAction) &&
            (!blockedItem || item.id === primaryBlocked?.id || stack);
          return (
            <li
              key={item.id}
              className={cn(
                "flex min-w-0 items-start gap-x-2 gap-y-1.5 text-sm",
                stack ? "flex-col" : "flex-wrap",
              )}
              data-testid={`readiness-item-${item.id}`}
              data-status={item.status}
            >
              <div className="flex min-w-0 w-full items-start gap-2">
                {ok ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden
                  />
                ) : blockedItem ? (
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                    aria-hidden
                  />
                ) : (
                  <Circle
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1 basis-[min(100%,12rem)]">
                  <div className="font-medium break-words">{t(item.titleKey)}</div>
                  {item.reasonKey ? (
                    <p className="text-xs text-muted-foreground break-words">
                      {t(item.reasonKey)}
                    </p>
                  ) : null}
                </div>
                {showInlineCta && !stack ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="max-w-full shrink-0 whitespace-normal text-left sm:whitespace-nowrap"
                    onClick={() => props.onAction?.(item.ctaAction!)}
                    data-testid={`readiness-cta-${item.id}`}
                  >
                    {t(item.ctaKey!)}
                  </Button>
                ) : null}
              </div>
              {showInlineCta && stack && item.ctaKey && item.ctaAction ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="box-border w-full max-w-full min-w-0 whitespace-normal text-left"
                  onClick={() => props.onAction?.(item.ctaAction!)}
                  data-testid={`readiness-cta-${item.id}`}
                >
                  {t(item.ctaKey)}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {/* Extra blocked CTAs when inline: collapse on small screens */}
      {!stack && blocked.length > 1 ? (
        <div
          className="flex min-w-0 flex-wrap gap-2 sm:hidden"
          data-testid="readiness-collapsed-ctas"
        >
          {blocked.slice(1).map((item) =>
            item.ctaKey && item.ctaAction ? (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant="outline"
                className="max-w-full min-w-0 flex-1 basis-[calc(50%-0.25rem)] whitespace-normal text-left"
                onClick={() => props.onAction?.(item.ctaAction!)}
                data-testid={`readiness-cta-${item.id}`}
              >
                {t(item.ctaKey)}
              </Button>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}
