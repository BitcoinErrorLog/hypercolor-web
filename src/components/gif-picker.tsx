"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalSheet } from "@/components/ui/sheet";

export type GifHit = {
  id: string;
  width: number;
  height: number;
  previewUrl?: string;
  gifUrl?: string;
};

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
  const [error, setError] = useState<string | null>(configured ? null : "GIF search not configured");
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!configured) {
      setError("GIF search not configured");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/gif/search?q=${encodeURIComponent(query.trim())}`);
      if (res.status === 503) {
        setError("GIF search not configured");
        setItems([]);
        return;
      }
      const json = (await res.json()) as { items?: GifHit[]; error?: string };
      if (!res.ok) {
        setError(json.error ?? "GIF search failed");
        setItems([]);
        return;
      }
      setItems(json.items ?? []);
    } catch {
      setError("GIF search not configured");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalSheet open={open} onClose={onClose} labelledBy="gifPickerLabel" testId="gifPicker" surface="gif-picker">
      <p id="gifPickerLabel" className="text-sm font-medium">
        GIF search
      </p>
      {!configured || error === "GIF search not configured" ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="gifNotConfigured">
          GIF search not configured
        </p>
      ) : (
        <>
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
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="block w-full overflow-hidden rounded"
                  onClick={() => onPick(item)}
                  data-testid="gifResult"
                >
                  {/* preview is a Tenor CDN thumbnail chosen via our proxy search; bytes are fetched separately */}
                  <img src={`/api/gif/fetch?id=${encodeURIComponent(item.id)}&kind=preview`} alt="" width={item.width || 120} height={item.height || 80} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </ModalSheet>
  );
}
