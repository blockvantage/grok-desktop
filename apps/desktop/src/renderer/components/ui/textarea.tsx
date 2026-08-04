import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-hairline bg-white/[0.025] px-3 py-2 text-sm leading-relaxed text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] transition-colors",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:border-ring/45 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
