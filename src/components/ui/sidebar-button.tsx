import type { ComponentProps, ComponentType } from "react";
import { Button } from "@/components/ui/button";

export function SidebarButton({
  icon: Icon,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Button variant="outline" size="sm" className="w-full border-border bg-white/5 text-xs font-bold" {...props}>
      <Icon className="size-4" />
      {children}
    </Button>
  );
}
