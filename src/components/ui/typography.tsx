import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TypographyProps {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "label";
  children: ReactNode;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
}

export function Typography({
  as: Tag = "p",
  children,
  className,
  size = "md",
  ...props
}: TypographyProps & HTMLAttributes<HTMLElement>) {
  const sizeClasses = {
    xs: "text-xs font-medium",
    sm: "text-sm font-medium",
    md: "text-base font-medium",
    lg: "text-2xl font-bold",
    xl: "text-4xl font-bold",
    "2xl": "text-6xl font-bold",
  };
  return (
    <Tag className={cn(sizeClasses[size], "text-foreground", className)} {...props}>
      {children}
    </Tag>
  );
}
