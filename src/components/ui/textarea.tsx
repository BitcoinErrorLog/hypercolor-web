import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const textareaVariants = cva(
  "flex field-sizing-content w-full rounded-md bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "min-h-16 border border-input px-3 py-2 shadow-xs focus-visible:ring-2 focus-visible:ring-ring",
        inline: "min-h-6 resize-none border-none p-0 shadow-none",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Textarea({
  className,
  variant,
  ...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
  return <textarea data-slot="textarea" {...props} className={cn(textareaVariants({ variant }), className)} />;
}

export { Textarea, textareaVariants };
