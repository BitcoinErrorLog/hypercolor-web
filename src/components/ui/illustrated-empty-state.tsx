import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Typography } from "@/components/ui/typography";

export function IllustratedEmptyState({
  icon: Icon,
  title,
  subtitle,
  children,
  className,
}: {
  icon: ComponentType<{ className?: string; size?: number }>;
  title: string;
  subtitle: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("relative flex flex-col items-center justify-center gap-3 px-4 py-5", className)}
      data-slot="empty-state"
    >
      <div className="relative z-10 flex size-16 shrink-0 items-center justify-center rounded-full bg-brand/16">
        <Icon className="size-8 text-brand" size={32} />
      </div>
      <div className="relative z-10 flex w-full min-w-0 flex-col items-center">
        <Typography as="h3" className="text-center text-xl font-bold leading-7">
          {title}
        </Typography>
        <Typography as="p" className="mt-1 text-center text-base font-medium text-secondary-foreground">
          {subtitle}
        </Typography>
      </div>
      {children}
    </div>
  );
}
