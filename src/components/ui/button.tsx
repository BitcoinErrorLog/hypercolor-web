"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer rounded-full border shadow-xs",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground hover:bg-accent border-secondary",
        brand: "hc-brand-cta border-brand hover:opacity-95",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent border-secondary",
        ghost: "border-transparent hover:bg-accent hover:text-accent-foreground",
        outline: "bg-background border-input hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive/60 text-destructive-foreground hover:bg-destructive/90 border-destructive",
        link: "border-transparent shadow-none hc-brand-muted underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-1 px-4 py-2",
        sm: "h-10 gap-1.5 px-3",
        icon: "size-11",
        lg: "h-12 px-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
    }
>(function Button({ className, variant, size, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      ref={ref}
      {...props}
    />
  );
});

export { Button, buttonVariants };
