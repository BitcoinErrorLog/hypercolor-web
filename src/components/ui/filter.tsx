import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Heading } from "@/components/ui/heading";
import { Typography } from "@/components/ui/typography";

export function FilterRoot({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <div data-slot="filter-root" className={cn("m-0 min-w-0 flex flex-col gap-2 bg-background p-0", className)} {...props}>
      {children}
    </div>
  );
}

export function FilterHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div data-slot="filter-header" className="m-0 flex flex-col gap-2 p-0">
      <Heading level={2} size="lg" className="font-light text-muted-foreground">
        {title}
      </Heading>
      {subtitle ? (
        <Typography size="md" className="text-base font-medium text-secondary-foreground">
          {subtitle}
        </Typography>
      ) : null}
    </div>
  );
}
