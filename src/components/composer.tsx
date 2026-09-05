"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModalSheet } from "@/components/ui/sheet";

/**
 * Composer actions slot contract:
 * - Render only working controls (no disabled placeholders).
 * - Place extra actions (emoji, GIF, …) in `actions` as they become real.
 * - The default slot is the Send button. Custom `actions` should include Send
 *   or an equivalent submit control so the layout stays attach | field | actions.
 */
function IconPhoto() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm8 3.5A3.5 3.5 0 1 0 15.5 12 3.5 3.5 0 0 0 12 8.5zM4 17l4.5-6 3.5 4.5 2.5-3L20 17z"
      />
    </svg>
  );
}

function IconFile() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 2 4 4h-4zM8 12h8v2H8zm0 4h8v2H8z"
      />
    </svg>
  );
}

function IconCancel() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L12 13.4 5.7 19.7 4.3 18.3 10.6 12 4.3 5.7 5.7 4.3 12 10.6l6.3-6.3z"
      />
    </svg>
  );
}

export function Composer({
  draft,
  sending,
  disabled,
  placeholder,
  onChangeDraft,
  onSend,
  onAttach,
  testIdPrefix,
  liveStatus,
  initialMenuOpen = false,
  actions,
}: {
  draft: string;
  sending: boolean;
  disabled?: boolean;
  placeholder: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onAttach?: (file: File) => void;
  testIdPrefix: string;
  liveStatus?: string | null;
  initialMenuOpen?: boolean;
  /** Extra working actions to the right of the field. Defaults to Send. */
  actions?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [accept, setAccept] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);
  const blocked = Boolean(disabled) || sending;
  const menuId = `${testIdPrefix}AttachMenu`;

  function closeMenu() {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

  function pick(kind: "photo" | "file") {
    setAccept(kind === "photo" ? "image/*" : undefined);
    closeMenu();
    window.setTimeout(() => fileRef.current?.click(), 0);
  }

  const sendButton = (
    <Button
      type="submit"
      variant="brand"
      disabled={blocked || draft.trim().length === 0}
      data-testid={`${testIdPrefix}Send`}
    >
      {sending ? "Sending…" : "Send"}
    </Button>
  );

  return (
    <form
      className="flex items-end gap-2 border-t border-border px-4 py-3"
      data-surface="composer"
      aria-busy={sending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked && draft.trim()) onSend();
      }}
    >
      {onAttach ? (
        <div className="shrink-0" data-slot="composer-attach">
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose attachment"
            data-testid={`${testIdPrefix}AttachInput`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onAttach(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={blocked}
            ref={triggerRef}
            aria-label="Attach file"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            data-testid={`${testIdPrefix}Attach`}
            onClick={() => setMenuOpen(true)}
          >
            +
          </Button>
          <ModalSheet
            open={menuOpen}
            onClose={closeMenu}
            role="menu"
            labelledBy={`${testIdPrefix}AttachMenuLabel`}
            testId={menuId}
            surface="attachment-menu"
          >
            <p id={`${testIdPrefix}AttachMenuLabel`} className="text-sm font-medium">
              Attach
            </p>
            <div className="flex flex-col">
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm"
                data-testid={`${testIdPrefix}AttachPhoto`}
                onClick={() => pick("photo")}
              >
                <IconPhoto />
                Photo
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm"
                data-testid={`${testIdPrefix}AttachFile`}
                onClick={() => pick("file")}
              >
                <IconFile />
                File
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm text-muted-foreground"
                data-testid={`${testIdPrefix}AttachCancel`}
                onClick={closeMenu}
              >
                <IconCancel />
                Cancel
              </button>
            </div>
          </ModalSheet>
        </div>
      ) : null}
      <Textarea
        value={draft}
        disabled={blocked}
        placeholder={placeholder}
        data-testid={`${testIdPrefix}Draft`}
        className="min-h-12 min-w-0 flex-1 text-base"
        onChange={(event) => onChangeDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="flex shrink-0 items-end gap-2" data-slot="composer-actions">
        {actions ?? sendButton}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {sending ? "Message sending" : liveStatus ?? ""}
      </p>
    </form>
  );
}
