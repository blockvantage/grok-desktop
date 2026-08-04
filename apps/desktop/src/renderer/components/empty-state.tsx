import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Calm empty surface for product rails (tasks, memory, artifacts, inbox).
 * Ice is scarce: icon well + primary CTA only — not a full wash.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-16 animate-fade-in",
        className,
      )}
    >
      <div
        className={cn(
          "surface-quiet flex w-full max-w-sm flex-col items-center gap-4 px-8 py-10 text-center",
          "border-hairline transition-shadow duration-200 ease-premium",
          "hover:shadow-[0_16px_40px_-24px_rgba(0,0,0,0.55),0_0_36px_-18px_rgba(159,221,255,0.18)]",
        )}
      >
        {icon && (
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl",
              "border border-primary/25 bg-primary/[0.1] text-primary",
              "shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset,0_0_20px_-8px_rgba(159,221,255,0.35)]",
            )}
            aria-hidden
          >
            {icon}
          </div>
        )}
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {description && (
            <p className="text-sm leading-relaxed text-muted-foreground/90">
              {description}
            </p>
          )}
        </div>
        {actionLabel && onAction && (
          <Button size="sm" onClick={onAction} className="mt-1">
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
