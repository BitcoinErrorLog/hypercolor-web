"use client";

import { useState } from "react";
import { CHAT_KIND_WORD_LABEL, isEmojiTagLabel, normalizeChatTagLabel, type ChatTagAggregate } from "@/types/chatKinds";

const QUICK = ["👍", "❤️", "😂", "🔥", "👎"] as const;

export function TagChips({
  tags,
  onToggle,
}: {
  tags: readonly ChatTagAggregate[];
  onToggle?: (label: string, mine: boolean) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" data-testid="tagChips" data-surface="tag-chips">
      {tags.map((tag) => (
        <li key={tag.label}>
          <button
            type="button"
            className={`inline-flex min-h-11 items-center rounded-full px-2 text-sm ${
              tag.mine ? "bg-primary/20 ring-1 ring-primary" : "bg-muted"
            }`}
            aria-pressed={tag.mine}
            aria-label={`${tag.label} ${tag.count}`}
            onClick={() => onToggle?.(tag.label, tag.mine)}
          >
            <span>{tag.label}</span>
            <span className="ml-1 text-xs opacity-80">{tag.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TagPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (label: string) => void;
}) {
  const [word, setWord] = useState("");
  const normalizedWord = normalizeChatTagLabel(word);
  const wordError =
    word.length > 0 && (normalizedWord === null || !CHAT_KIND_WORD_LABEL.test(normalizedWord))
      ? "Use 1–32 lowercase letters, numbers, or underscores."
      : null;
  if (!open) return null;
  return (
    <div
      className="space-y-2 rounded-md border border-border bg-background p-2 shadow-md"
      data-testid="tagPicker"
      data-surface="tag-picker"
      role="dialog"
      aria-label="Add a tag"
    >
      <div className="flex flex-wrap gap-1">
        {QUICK.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center"
            aria-label={`Tag ${emoji}`}
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!normalizedWord || !CHAT_KIND_WORD_LABEL.test(normalizedWord)) return;
          onPick(normalizedWord);
          setWord("");
          onClose();
        }}
      >
        <input
          className="min-h-11 flex-1 rounded-sm border border-border px-2 text-sm"
          value={word}
          onChange={(event) => setWord(event.target.value)}
          placeholder="word tag"
          aria-label="Word tag"
          aria-invalid={wordError !== null}
          aria-describedby={wordError ? "tagPickerWordError" : undefined}
        />
        <button
          type="submit"
          className="min-h-11 px-2 text-sm underline disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!normalizedWord || !CHAT_KIND_WORD_LABEL.test(normalizedWord)}
        >
          Tag
        </button>
      </form>
      {wordError ? (
        <p id="tagPickerWordError" className="text-sm text-destructive" role="alert">
          {wordError}
        </p>
      ) : null}
    </div>
  );
}

export function tagIsEmoji(label: string): boolean {
  return isEmojiTagLabel(label);
}
