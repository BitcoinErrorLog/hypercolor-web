"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModalSheet } from "@/components/ui/sheet";
import { EmojiPicker } from "@/components/emoji-picker";
import { GifPicker, type GifHit } from "@/components/gif-picker";
import { colonTokenAt, replaceColonToken, searchEmoji } from "@/lib/emoji/dataset";
import { clipboardImageFile, validateAttachFile } from "@/lib/attach-file";

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

export type ComposerQuote = {
  eventId: string;
  authorPubky: string;
  body: string;
};

export function Composer({
  draft,
  sending,
  disabled,
  sendBlocked,
  sendBlockedReason,
  placeholder,
  onChangeDraft,
  onSend,
  onAttach,
  testIdPrefix,
  liveStatus,
  initialMenuOpen = false,
  actions,
  quote,
  onClearQuote,
  pendingFile,
  pendingPreviewUrl,
  pendingError,
  onConfirmPending,
  onCancelPending,
  gifConfigured = false,
  onPickGif,
  initialEmojiOpen = false,
  initialGifOpen = false,
}: {
  draft: string;
  sending: boolean;
  disabled?: boolean;
  sendBlocked?: boolean;
  sendBlockedReason?: string;
  placeholder: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onAttach?: (file: File) => void;
  testIdPrefix: string;
  liveStatus?: string | null;
  initialMenuOpen?: boolean;
  /** Extra working actions to the right of the field. Defaults to emoji, GIF, Send. */
  actions?: ReactNode;
  quote?: ComposerQuote | null;
  onClearQuote?: () => void;
  pendingFile?: File | null;
  pendingPreviewUrl?: string | null;
  pendingError?: string | null;
  onConfirmPending?: () => void;
  onCancelPending?: () => void;
  gifConfigured?: boolean;
  onPickGif?: (hit: GifHit) => void;
  initialEmojiOpen?: boolean;
  initialGifOpen?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [accept, setAccept] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);
  const [emojiOpen, setEmojiOpen] = useState(initialEmojiOpen);
  const [gifOpen, setGifOpen] = useState(initialGifOpen);
  const [caret, setCaret] = useState(0);
  const fieldBlocked = Boolean(disabled) || sending;
  const blocked = fieldBlocked || Boolean(sendBlocked);
  const menuId = `${testIdPrefix}AttachMenu`;
  const colon = colonTokenAt(draft, caret);
  const suggestions = colon ? searchEmoji(colon.query, 6) : [];

  function closeMenu() {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

  function pick(kind: "photo" | "file") {
    setAccept(kind === "photo" ? "image/*" : undefined);
    closeMenu();
    window.setTimeout(() => fileRef.current?.click(), 0);
  }

  const sendReasonId = `${testIdPrefix}SendBlockedReason`;
  const canSend = !blocked && (draft.trim().length > 0 || Boolean(pendingFile));
  const sendButton = (
    <Button
      type="submit"
      variant="brand"
      disabled={!canSend}
      title={sendBlocked ? sendBlockedReason : undefined}
      aria-describedby={sendBlocked && sendBlockedReason ? sendReasonId : undefined}
      data-testid={`${testIdPrefix}Send`}
    >
      {sending ? "Sending…" : "Send"}
    </Button>
  );

  const defaultActions = (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={fieldBlocked}
        aria-label="Insert emoji"
        data-testid={`${testIdPrefix}Emoji`}
        onClick={() => setEmojiOpen(true)}
      >
        ☺
      </Button>
      {onPickGif ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fieldBlocked}
          aria-label="Insert GIF"
          data-testid={`${testIdPrefix}Gif`}
          onClick={() => setGifOpen(true)}
        >
          GIF
        </Button>
      ) : null}
      {sendButton}
    </>
  );

  return (
    <div className="border-t border-border" data-surface="composer">
      {quote ? (
        <div className="flex items-start justify-between gap-2 px-4 pt-3" data-testid={`${testIdPrefix}Quote`}>
          <blockquote className="min-w-0 flex-1 border-l-2 border-border pl-2 text-sm text-muted-foreground">
            {quote.body}
          </blockquote>
          {onClearQuote ? (
            <Button type="button" size="sm" variant="outline" onClick={onClearQuote}>
              Cancel reply
            </Button>
          ) : null}
        </div>
      ) : null}
      {pendingError ? (
        <p className="px-4 pt-2 text-sm hc-danger-text" data-testid={`${testIdPrefix}AttachError`}>
          {pendingError}
        </p>
      ) : null}
      {pendingFile ? (
        <div className="flex items-center gap-3 px-4 pt-3" data-testid={`${testIdPrefix}PendingAttach`}>
          {pendingPreviewUrl ? (
            <img src={pendingPreviewUrl} alt="" className="h-16 w-16 rounded object-cover" />
          ) : (
            <p className="text-sm">{pendingFile.name}</p>
          )}
          <p className="text-xs text-muted-foreground">{Math.ceil(pendingFile.size / 1024)} KB</p>
          {onConfirmPending ? (
            <Button type="button" size="sm" variant="brand" onClick={onConfirmPending}>
              Send file
            </Button>
          ) : null}
          {onCancelPending ? (
            <Button type="button" size="sm" variant="outline" onClick={onCancelPending}>
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    <form
      className="flex items-end gap-2 px-4 py-3"
      aria-busy={sending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (pendingFile && onConfirmPending && draft.trim().length === 0) {
          onConfirmPending();
          return;
        }
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
      <div className="relative min-w-0 flex-1">
      <Textarea
        ref={draftRef}
        value={draft}
        disabled={fieldBlocked}
        placeholder={placeholder}
        data-testid={`${testIdPrefix}Draft`}
        className="min-h-12 min-w-0 flex-1 text-base"
        onChange={(event) => {
          setCaret(event.target.selectionStart ?? event.target.value.length);
          onChangeDraft(event.target.value);
        }}
        onSelect={(event) => {
          const target = event.currentTarget;
          setCaret(target.selectionStart ?? target.value.length);
        }}
        onPaste={(event) => {
          if (!onAttach) return;
          const file = clipboardImageFile(event.nativeEvent);
          if (!file) return;
          const check = validateAttachFile(file);
          if (!check.ok) return;
          event.preventDefault();
          onAttach(file);
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && suggestions[0] && colon) {
            event.preventDefault();
            const replaced = replaceColonToken(draft, caret, suggestions[0].native);
            if (replaced) {
              onChangeDraft(replaced.text);
              setCaret(replaced.caret);
            }
            return;
          }
          if (event.key !== "Enter" || event.shiftKey) return;
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
      {suggestions.length > 0 ? (
        <ul
          className="absolute bottom-full left-0 z-40 mb-1 w-full rounded-md border border-border bg-card p-1"
          data-testid={`${testIdPrefix}EmojiSuggest`}
        >
          {suggestions.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-2 text-left text-sm"
                onClick={() => {
                  const replaced = replaceColonToken(draft, caret, entry.native);
                  if (replaced) {
                    onChangeDraft(replaced.text);
                    setCaret(replaced.caret);
                    draftRef.current?.focus();
                  }
                }}
              >
                <span>{entry.native}</span>
                <span className="text-muted-foreground">:{entry.id}:</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
      <div className="flex shrink-0 items-end gap-2" data-slot="composer-actions">
        {actions ?? defaultActions}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {sending ? "Message sending" : liveStatus ?? ""}
      </p>
    </form>
      <ModalSheet
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        labelledBy={`${testIdPrefix}EmojiLabel`}
        testId={`${testIdPrefix}EmojiSheet`}
        surface="emoji-picker"
      >
        <p id={`${testIdPrefix}EmojiLabel`} className="text-sm font-medium">
          Emoji
        </p>
        <EmojiPicker
          onSelect={(entry) => {
            const input = draftRef.current;
            const start = input?.selectionStart ?? draft.length;
            const end = input?.selectionEnd ?? draft.length;
            onChangeDraft(`${draft.slice(0, start)}${entry.native}${draft.slice(end)}`);
            setEmojiOpen(false);
          }}
        />
      </ModalSheet>
      {onPickGif ? (
        <GifPicker
          open={gifOpen}
          onClose={() => setGifOpen(false)}
          configured={gifConfigured}
          onPick={(hit) => {
            setGifOpen(false);
            onPickGif(hit);
          }}
        />
      ) : null}
    </div>
  );
}
