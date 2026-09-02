"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalSheet } from "@/components/ui/sheet";

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
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [accept, setAccept] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
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

  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
      aria-busy={sending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked && draft.trim()) onSend();
      }}
    >
      {onAttach ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            className="sr-only"
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
        </>
      ) : null}
      <Input
        value={draft}
        disabled={blocked}
        placeholder={placeholder}
        data-testid={`${testIdPrefix}Draft`}
        onChange={(event) => onChangeDraft(event.target.value)}
      />
      <Button
        type="submit"
        disabled={blocked || draft.trim().length === 0}
        data-testid={`${testIdPrefix}Send`}
      >
        {sending ? "Sending…" : "Send"}
      </Button>
      <p className="sr-only" role="status" aria-live="polite">
        {sending ? "Message sending" : liveStatus ?? ""}
      </p>
    </form>
  );
}
