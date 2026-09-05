"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";

export type MobileTabBarItem = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  isActive: boolean;
  onSelect?: () => void;
};

export function MobileTabBar({
  items,
  showLabels = false,
  className,
}: {
  items: readonly MobileTabBarItem[];
  showLabels?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "z-(--z-mobile-menu) bg-background lg:hidden",
        className,
      )}
      data-slot="mobile-tab-bar"
    >
      <div className="flex w-full">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.key}
              className={cn(
                "flex flex-1 justify-center border-b px-0 py-1.5",
                item.isActive ? "border-foreground" : "border-border",
              )}
            >
              <Button
                variant="ghost"
                onClick={item.onSelect}
                className={cn("h-auto border-0 px-2.5 py-2 shadow-none", showLabels && "flex items-center gap-2")}
                aria-current={item.isActive ? "page" : undefined}
              >
                <Icon size={20} className={item.isActive ? "text-foreground" : "text-muted-foreground"} />
                {showLabels ? (
                  <Typography
                    as="span"
                    className={cn("text-sm font-medium", item.isActive ? "text-foreground" : "text-muted-foreground")}
                  >
                    {item.label}
                  </Typography>
                ) : null}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
