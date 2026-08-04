import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Icon-only control with an accessible label + hover tooltip.
 * Prefer this over long button labels in dense chrome (toolbars, headers).
 */
export function IconTooltipButton({
  label,
  shortcut,
  side = "bottom",
  children,
  className,
  ...buttonProps
}: Omit<ButtonProps, "children" | "size" | "title"> & {
  label: string;
  /** Optional shortcut shown dimmed in the tooltip (e.g. ⌘K). */
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          type="button"
          aria-label={label}
          className={cn(
            // Animate-ui icons listen on the SVG; keep pointer events so hover runs.
            "[&_svg]:pointer-events-auto",
            className,
          )}
          {...buttonProps}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side} className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut ? (
          <kbd className="rounded border border-white/10 bg-white/[0.06] px-1 py-px font-mono text-2xs text-muted-foreground">
            {shortcut}
          </kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Wraps any control (segmented toggle, ghost chip, etc.) with a tooltip + aria-label.
 */
export function WithTooltip({
  label,
  side = "bottom",
  children,
  asChild = true,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
  asChild?: boolean;
}) {
  const child = asChild
    ? React.cloneElement(children, {
        "aria-label":
          (children.props as { "aria-label"?: string })["aria-label"] ?? label,
      })
    : children;

  return (
    <Tooltip>
      <TooltipTrigger asChild={asChild}>{child}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
