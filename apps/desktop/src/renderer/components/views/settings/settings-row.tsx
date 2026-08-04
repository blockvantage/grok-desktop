import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** SC-1: one settings section header language. */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * SC-1: one settings row — label + description left, control right.
 * Tokenized container; no raw white/[0.06] recipes.
 */
export function SettingsRow({
  label,
  description,
  control,
  className,
}: {
  label: string;
  description?: string;
  control?: ReactNode;
  className?: string;
}) {
  const labelId = useId();

  // C-3: wire the control's accessible name to this row's label, unless the
  // control already declares its own aria-label or aria-labelledby.
  // Trap: this fires for ANY element control, so controls that name themselves
  // from visible content (buttons, selects) must pass their own aria-label, and
  // wrapper elements/fragments must not be passed bare as `control`.
  let namedControl = control;
  if (isValidElement(control)) {
    const controlProps = control.props as {
      "aria-label"?: string;
      "aria-labelledby"?: string;
    };
    if (!controlProps["aria-label"] && !controlProps["aria-labelledby"]) {
      namedControl = cloneElement(
        control as ReactElement<{ "aria-labelledby"?: string }>,
        { "aria-labelledby": labelId },
      );
    }
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/40 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </div>
        {description ? (
          <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {control ? <div className="shrink-0">{namedControl}</div> : null}
    </div>
  );
}

/** Informational row — muted text, no control chrome (SC-5). */
export function SettingsInfoRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1.5 text-sm",
        className,
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground/85">{value}</span>
    </div>
  );
}
