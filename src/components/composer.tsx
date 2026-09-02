"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const [accept, setAccept] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const blocked = Boolean(disabled) || sending;

  function pick(kind: "photo" | "file") {
    setAccept(kind === "photo" ? "image/*" : undefined);
    setMenuOpen(false);
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
          <div className="relative">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={blocked}
              aria-label="Attach file"
              aria-expanded={menuOpen}
              data-testid={`${testIdPrefix}Attach`}
              onClick={() => setMenuOpen((open) => !open)}
            >
              +
            </Button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute bottom-12 left-0 z-20 min-w-40 rounded-md border border-border bg-card p-1 shadow"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center px-3 text-left text-sm"
                  onClick={() => pick("photo")}
                >
                  Photo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center px-3 text-left text-sm"
                  onClick={() => pick("file")}
                >
                  File
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center px-3 text-left text-sm text-muted-foreground"
                  onClick={() => setMenuOpen(false)}
                >
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
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
