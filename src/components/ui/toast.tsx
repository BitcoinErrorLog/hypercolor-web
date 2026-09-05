import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const toastVariants = cva(
  "relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-lg border p-6 shadow-lg backdrop-blur-[10px]",
  {
    variants: {
      variant: {
        default: "border-brand/32 bg-brand/8",
        error: "border-destructive/32 bg-destructive/8",
        warning: "border-warning/32 bg-warning/8",
        info: "border-accent/32 bg-accent/8",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Toast({
  className,
  variant,
  title,
  description,
  ...props
}: VariantProps<typeof toastVariants> & {
  className?: string;
  title: string;
  description?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="status" data-slot="toast" className={cn(toastVariants({ variant }), className)} {...props}>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-bold text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

export { toastVariants };
