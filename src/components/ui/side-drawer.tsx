"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SideDrawer({
  open,
  side = "left",
  children,
  title,
}: {
  open: boolean;
  side?: "left" | "right";
  children: ReactNode;
  title: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/50" data-slot="side-drawer">
      <aside
        aria-label={title}
        className={cn(
          "absolute top-0 h-full w-72 overflow-y-auto border-border bg-card p-4",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
        )}
      >
        {children}
      </aside>
    </div>
  );
}
