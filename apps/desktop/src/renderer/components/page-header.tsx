import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page-level header for denser product views (settings-adjacent / list heroes).
 * Frost title hierarchy on midnight chrome; ice only if actions include primary CTAs.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-display text-foreground">
          {title}
        </h2>
        {description && (
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground/90">
            {description}
          </p>
        )}
        {/* Quiet ice accent under the title block — scarce brand cue, not a wash */}
        <div
          className="mt-2 h-px w-10 bg-gradient-to-r from-primary/55 to-transparent"
          aria-hidden
        />
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      )}
    </div>
  );
}
