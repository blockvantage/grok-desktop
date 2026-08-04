import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Consistent section header used across product surfaces. */
export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-3.5 flex items-end justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground/85">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function LinkAction({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 text-xs font-medium text-primary/90 transition-colors hover:text-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}
