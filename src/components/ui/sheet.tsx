"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { listFocusable, moveRovingIndex, trapTabKey } from "@/lib/focus-trap";
import { scriptedMotionMs } from "@/lib/reduced-motion";
import { cn } from "@/lib/utils";

type SheetRole = "dialog" | "alertdialog" | "menu";
type SheetLayer = "sheet" | "gate";

function gateOverlayMounted(): boolean {
  return typeof document !== "undefined" && Boolean(document.querySelector('[data-sheet-layer="gate"]'));
}

function isUsefulRestoreTarget(el: HTMLElement | null): el is HTMLElement {
  if (!el?.isConnected) return false;
  if (el === document.body || el === document.documentElement) return false;
  return true;
}

function inertBackground(overlay: HTMLElement): () => void {
  const blocked: HTMLElement[] = [];
  for (const child of Array.from(document.body.children)) {
    if (child === overlay) continue;
    if (!(child instanceof HTMLElement)) continue;
    if (child.inert) continue;
    child.inert = true;
    blocked.push(child);
  }
  return () => {
    for (const el of blocked) {
      el.inert = false;
    }
  };
}

export function ModalSheet({
  open,
  onClose,
  titleId,
  descriptionId,
  labelledBy,
  role = "dialog",
  layer = "sheet",
  initialFocusRef,
  restoreFocus,
  children,
  testId,
  closeOnBackdrop = true,
  surface,
}: {
  open: boolean;
  onClose: () => void;
  titleId?: string;
  descriptionId?: string;
  labelledBy?: string;
  role?: SheetRole;
  layer?: SheetLayer;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  restoreFocus?: () => HTMLElement | null;
  children: ReactNode;
  testId?: string;
  closeOnBackdrop?: boolean;
  surface?: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [catalogPortal, setCatalogPortal] = useState<HTMLElement | null>(null);
  const labelId = useId();
  const dialogRole = role === "menu" ? "dialog" : role;
  const shown = open && (layer === "gate" || !gateOverlayMounted());

  useEffect(() => {
    if (!shown) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    const releaseInert = overlay ? inertBackground(overlay) : () => undefined;
    const enterMs = scriptedMotionMs(150);
    if (panel && enterMs > 0 && typeof panel.animate === "function") {
      panel.animate(
        [
          { opacity: 0, transform: "translateY(16px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: enterMs, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
    const timer = window.setTimeout(() => {
      const focusTarget =
        initialFocusRef?.current ?? listFocusable(panel ?? document.body)[0] ?? panel;
      focusTarget?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      releaseInert();
      if (document.querySelector('[aria-modal="true"]')) return;
      const captured = restoreRef.current;
      const fallback = restoreFocus?.() ?? null;
      const main = document.getElementById("main-content");
      const target =
        (isUsefulRestoreTarget(captured) ? captured : null) ??
        (isUsefulRestoreTarget(fallback) ? fallback : null) ??
        (main instanceof HTMLElement ? main : null);
      target?.focus();
    };
  }, [shown, initialFocusRef, restoreFocus]);

  useEffect(() => {
    if (!__HYPERCOLOR_E2E_HARNESS__) return;
    const timer = window.setTimeout(() => {
      setCatalogPortal(document.querySelector<HTMLElement>("[data-vrt-portal-root]"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!shown) return null;

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

  const overlay = (
    <div
      ref={overlayRef}
      className={cn(
        "fixed inset-0 flex items-end justify-center bg-black/60 p-0 md:items-center md:px-6",
        layer === "gate" ? "z-60" : "z-50",
      )}
      data-sheet-layer={layer}
      data-testid={testId}
      onMouseDown={(event) => {
        if (!closeOnBackdrop) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={dialogRole}
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId ?? (role === "menu" ? labelId : undefined)}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="sheet-enter max-h-[calc(100dvh-2rem)] max-w-md space-y-4 overflow-y-auto rounded-t-md border border-border bg-card p-5 shadow md:rounded-md"
        style={{ width: "100vw", maxWidth: "28rem" }}
        data-surface={surface}
        onKeyDown={onKeyDown}
      >
        {role === "menu" && !labelledBy && !titleId ? (
          <span id={labelId} className="sr-only">
            Attach
          </span>
        ) : null}
        {role === "menu" ? (
          <div role="menu" aria-labelledby={labelledBy ?? titleId ?? labelId}>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, catalogPortal ?? document.body);
}
