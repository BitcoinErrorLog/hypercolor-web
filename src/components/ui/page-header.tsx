import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ children, className, ...props }: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-3 pt-2 pb-6", className)} {...props}>
      {children}
    </div>
  );
}

export function PageSubtitle({
  as: Component = "h2",
  className,
  children,
}: {
  as?: "h2" | "h5" | "p";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Component className={cn("w-full min-w-0 text-xl leading-normal font-light text-muted-foreground lg:text-2xl", className)}>
      {children}
    </Component>
  );
}
