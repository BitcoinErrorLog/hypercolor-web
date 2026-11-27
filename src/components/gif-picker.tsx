"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalSheet } from "@/components/ui/sheet";

export type GifHit = {
  id: string;
  preview: { url: string; w: number; h: number };
  gif: { url: string; w: number; h: number; bytes?: number };
};

export function toSameOriginGifFetchPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, typeof window !== "undefined" ? window.location.origin : "https://hypercolor.app");
    if (parsed.pathname === "/api/gif/fetch") {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Reject non-proxy URLs below.
  }
  return "";
}

export function GifPicker({
  open,
  onClose,
  onPick,
  configured = true,
  fixtureItems,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (hit: GifHit) => void;
  configured?: boolean;
  fixtureItems?: GifHit[];
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GifHit[]>(fixtureItems ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!configured) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/gif/search?q=${encodeURIComponent(query.trim())}`);
      const json = (await res.json()) as { results?: GifHit[]; error?: string };
      if (!res.ok) {
        setError(res.status === 503 ? "GIF search not configured" : (json.error ?? "GIF search failed"));
        setItems([]);
        return;
      }
      setItems(Array.isArray(json.results) ? json.results : []);
    } catch {
      setError("GIF search failed");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }

  if (!configured) return null;

  return (
    <ModalSheet open={open} onClose={onClose} labelledBy="gifPickerLabel" testId="gifPicker" surface="gif-picker">
      <p id="gifPickerLabel" className="text-sm font-medium">
        GIF search
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search GIFs"
          data-testid="gifSearchInput"
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </Button>
      </form>
      {error ? <p className="mt-2 text-sm hc-danger-text">{error}</p> : null}
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {items.map((item) => {
          const previewSrc = toSameOriginGifFetchPath(item.preview.url);
          if (!previewSrc) return null;
          return (
            <li key={item.id}>
              <button
                type="button"
                className="block w-full overflow-hidden rounded"
                onClick={() => onPick(item)}
                data-testid="gifResult"
              >
                <img src={previewSrc} alt="" width={item.preview.w || 120} height={item.preview.h || 80} />
              </button>
            </li>
          );
        })}
      </ul>
    </ModalSheet>
  );
}
