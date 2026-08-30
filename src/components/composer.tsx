"use client";

import { useRef } from "react";
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
}: {
  draft: string;
  sending: boolean;
  disabled?: boolean;
  placeholder: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onAttach?: (file: File) => void;
  testIdPrefix: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const blocked = Boolean(disabled) || sending;

  return (
    <form
      className="flex items-end gap-2 border-t border-border pt-3"
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
            className="sr-only"
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
            aria-label="Attach file"
            data-testid={`${testIdPrefix}Attach`}
            onClick={() => fileRef.current?.click()}
          >
            +
          </Button>
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
    </form>
  );
}
