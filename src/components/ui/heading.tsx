import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Heading({
  level = 1,
  children,
  className,
  size = "md",
}: {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
}) {
  const Tag = `h${level}` as const;
  const sizeClasses = {
    sm: "text-lg font-semibold",
    md: "text-xl font-semibold",
    lg: "text-2xl font-bold",
    xl: "text-4xl font-bold",
    "2xl": "text-7xl font-bold",
  };
  return <Tag className={cn(sizeClasses[size], "text-foreground", className)}>{children}</Tag>;
}
