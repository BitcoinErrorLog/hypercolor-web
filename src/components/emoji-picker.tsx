"use client";

import { EMOJI_DATASET, searchEmoji, type EmojiEntry } from "@/lib/emoji/dataset";

export function EmojiPicker({
  onSelect,
  query = "",
  testId = "emojiPicker",
}: {
  onSelect: (entry: EmojiEntry) => void;
  query?: string;
  testId?: string;
}) {
  const items = query ? searchEmoji(query, 48) : EMOJI_DATASET;
  return (
    <div
      className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto p-2"
      data-surface="emoji-picker"
      data-testid={testId}
      role="listbox"
      aria-label="Emoji"
    >
      {items.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="option"
          aria-selected={false}
          className="inline-flex min-h-11 min-w-11 items-center justify-center text-xl"
          aria-label={entry.name}
          onClick={() => onSelect(entry)}
        >
          {entry.native}
        </button>
      ))}
    </div>
  );
}
