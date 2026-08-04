import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium tracking-tight transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/90 text-primary-foreground shadow-sm",
        secondary:
          "border-hairline bg-white/[0.05] text-foreground/85",
        destructive:
          "border-transparent bg-destructive/90 text-destructive-foreground",
        outline: "border-hairline bg-transparent text-foreground/85",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
