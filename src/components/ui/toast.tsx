"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const toastVariants = cva(
  "relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-lg border p-6 shadow-lg hc-toast-blur",
  {
    variants: {
      variant: {
        default: "hc-toast-default",
        error: "border-destructive/32 bg-destructive/8",
        warning: "border-warning/32 bg-warning/8",
        info: "border-accent/32 bg-accent/8",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Toast({
  className,
  variant,
  title,
  description,
  ...props
}: VariantProps<typeof toastVariants> & {
  className?: string;
  title: string;
  description?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="status" data-slot="toast" className={cn(toastVariants({ variant }), className)} {...props}>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-bold text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

type ToastItem = {
  id: number;
  title: string;
  description?: string;
  variant?: VariantProps<typeof toastVariants>["variant"];
};

const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];
let nextId = 1;

function emitToasts() {
  for (const listener of listeners) listener(items);
}

export function toast(input: { title: string; description?: string; variant?: ToastItem["variant"] }) {
  const id = nextId++;
  items = [...items, { id, ...input }];
  emitToasts();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emitToasts();
  }, 5000);
}

export function Toaster({ children }: { children?: ReactNode } = {}) {
  const [toasts, setToasts] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-4">
      {toasts.map((item) => (
        <Toast key={item.id} title={item.title} description={item.description} variant={item.variant} />
      ))}
      {children}
    </div>
  );
}
