"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { listFocusable, moveRovingIndex, trapTabKey } from "@/lib/focus-trap";

export type SheetRole = "dialog" | "alertdialog" | "menu";

export function ModalSheet({
  open,
  onClose,
  titleId,
  descriptionId,
  labelledBy,
  role = "dialog",
  initialFocusRef,
  children,
  testId,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  titleId?: string;
  descriptionId?: string;
  labelledBy?: string;
  role?: SheetRole;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  testId?: string;
  closeOnBackdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const labelId = useId();

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    window.setTimeout(() => {
      const focusTarget =
        initialFocusRef?.current ?? listFocusable(panel ?? document.body)[0] ?? panel;
      focusTarget?.focus();
    }, 0);
    return () => {
      restoreRef.current?.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    trapTabKey(event.nativeEvent, panel);
    if (role !== "menu") return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    const items = Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.findIndex((item) => item === document.activeElement);
    const next = moveRovingIndex(current < 0 ? 0 : current, event.key, items.length);
    items[next]?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 md:items-center md:px-6"
      data-testid={testId}
      onMouseDown={(event) => {
        if (!closeOnBackdrop) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId ?? (role === "menu" ? labelId : undefined)}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-md space-y-4 rounded-t-md border border-border bg-card p-5 shadow md:rounded-md"
        onKeyDown={onKeyDown}
      >
        {role === "menu" && !labelledBy && !titleId ? (
          <span id={labelId} className="sr-only">
            Attach
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
