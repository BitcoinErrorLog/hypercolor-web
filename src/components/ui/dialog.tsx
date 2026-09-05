"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Dialog({
  open,
  title,
  children,
  className,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" data-slot="dialog">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "w-full max-w-lg rounded-t-lg bg-card p-6 sm:rounded-xl sm:p-8",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export { ModalSheet } from "./sheet";
