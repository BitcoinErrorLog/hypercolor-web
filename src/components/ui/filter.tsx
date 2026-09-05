import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

export function FilterList({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <div data-slot="filter-list" className={cn("flex flex-col gap-1", className)} {...props}>
      {children}
    </div>
  );
}

export function FilterItem({
  isSelected = false,
  className,
  children,
  ...props
}: {
  isSelected?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      data-slot="filter-item"
      aria-pressed={isSelected}
      variant="ghost"
      className={cn(
        "h-auto w-full justify-start rounded-none border-0 px-0 py-1 text-left text-base font-medium shadow-none",
        isSelected ? "text-foreground" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function FilterItemLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={className}>{children}</span>;
}
