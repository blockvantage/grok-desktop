/**
 * Presentational rail card for HomeView (Phase 6 residual extract).
 */
import type { ReactNode } from "react";

export function HomeRailCard({
  title,
  icon,
  meta,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="surface-quiet p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            {icon && (
              <span className="text-muted-foreground">{icon}</span>
            )}
            {title}
          </div>
          {meta && (
            <p className="mt-0.5 text-2xs text-muted-foreground">{meta}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
