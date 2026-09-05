import type { ComponentType, ReactNode } from "react";
import { Typography } from "@/components/ui/typography";

export function IllustratedEmptyState({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: ComponentType<{ className?: string; size?: number }>;
  title: string;
  subtitle: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-6 p-6" data-slot="empty-state">
      <div className="relative z-10 flex shrink-0 items-center justify-center rounded-full bg-brand/16 p-6">
        <Icon className="size-12 text-brand" size={48} />
      </div>
      <div className="relative z-10 flex w-full flex-col items-center">
        <Typography as="h3" size="lg" className="pb-6 text-center leading-8">
          {title}
        </Typography>
        <Typography as="p" className="text-center text-base font-medium text-secondary-foreground">
          {subtitle}
        </Typography>
      </div>
      {children}
    </div>
  );
}
