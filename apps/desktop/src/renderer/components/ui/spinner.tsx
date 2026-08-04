import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-3.5 w-3.5 border-[1.5px]",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-2",
} as const;

export type SpinnerSize = keyof typeof SIZES;

/** DS-8: one spinner recipe for buttons, inline pending, and panel loading. */
export function Spinner({
  size = "md",
  className,
  label = "Loading",
}: {
  size?: SpinnerSize;
  className?: string;
  /** Accessible name when no surrounding text. */
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        // Electric activity ring (processing)
        "inline-block animate-spin rounded-full border-ring/25 border-t-ring ease-linear",
        SIZES[size],
        className,
      )}
    />
  );
}
