import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Electric focus ring wins over variant shadows (global :focus-visible alone loses to utility box-shadow)
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium tracking-tight transition-all duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.985]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_8px_22px_-10px_rgba(159,221,255,0.45)] hover:bg-[hsl(var(--primary-hover))]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/[0.92]",
        outline:
          "border border-hairline bg-white/[0.025] text-foreground shadow-hairline-top hover:bg-white/[0.05] hover:border-hairline-strong",
        secondary:
          "bg-white/[0.055] text-secondary-foreground shadow-hairline-top hover:bg-white/[0.08]",
        ghost:
          "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-8 rounded-lg px-2.5 text-xs",
        lg: "h-10 rounded-lg px-5 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
