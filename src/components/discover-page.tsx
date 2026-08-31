"use client";

import Link from "next/link";
import { useState } from "react";
import { TagChannelView } from "@/components/tag-channel-view";
import { Button } from "@/components/ui/button";
import { usePathSegment } from "@/hooks/usePathSegment";
import { sanitizePublicTag } from "@/lib/public-text";
import { encodeTagPath, normalizeTagLabel } from "@/lib/tag-channel";
import { TagChannelReader } from "@/services/nexus/tagChannel";
import type { NexusHotTag } from "@/services/nexus/NexusDiscoveryClient";
import {
  createDiscoverTopicsLoader,
  initialDiscoverTopicsView,
} from "./discover-topics";

export function DiscoverPage() {
  const selected = usePathSegment("discover");
  const [loader] = useState(() =>
    createDiscoverTopicsLoader(() => TagChannelReader.loadDirectory()),
  );
  const [tags, setTags] = useState<NexusHotTag[]>(initialDiscoverTopicsView().tags);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(initialDiscoverTopicsView().loaded);
  const [error, setError] = useState<string | null>(initialDiscoverTopicsView().error);

  async function loadTopics(): Promise<void> {
    setLoading(true);
    setError(null);
    const view = await loader.load();
    setLoading(false);
    setTags(view.tags);
    setLoaded(view.loaded);
    setError(view.error);
  }

  return (
    <div
      className="grid min-h-[70vh] gap-6 md:grid-cols-[minmax(16rem,20rem)_1fr]"
      data-testid="discoverScreen"
    >
      <aside className={selected ? "hidden md:block" : undefined}>
        <h1 className="text-2xl font-semibold tracking-tight">Discover</h1>
        <p className="mt-2 text-sm text-muted-foreground" data-testid="discoverPrivacyCopy">
          This is the global public index — rooms anyone can already query. Loading topics
          asks the index for the hot-tag list; the operator sees that query. Opening a topic
          is a public read; the index operator sees which tags you look up. Private DMs and
          groups stay on Chats and Channels and are never sent here. Skip this page if you
          do not want that query to happen.
        </p>
        {!loaded ? (
          <Button
            type="button"
            size="sm"
            className="mt-6"
            disabled={loading}
            data-testid="discoverLoadTopics"
            onClick={() => void loadTopics()}
          >
            {loading ? "Loading topics…" : error ? "Retry public topics" : "Load public topics"}
          </Button>
        ) : null}
        {error ? (
          <p className="mt-6 text-sm text-red-400" data-testid="discoverError">
            {error}
          </p>
        ) : null}
        {loaded && !error && tags.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground" data-testid="discoverEmpty">
            The public index has no hot tags right now.
          </p>
        ) : null}
        {tags.length > 0 ? (
          <ul className="mt-4 divide-y divide-border" data-testid="discoverHotTags">
            {tags.flatMap((tag) => {
              const label = normalizeTagLabel(tag.label);
              if (!label) return [];
              return [
                <li key={label}>
                  <Link
                    href={`/discover/${encodeTagPath(label)}`}
                    data-testid="discoverTagRow"
                    className="block py-3 hover:bg-accent/40"
                  >
                    <span className="font-medium">#{sanitizePublicTag(label)}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {tag.taggedCount} posts · {tag.taggersCount} taggers
                    </span>
                  </Link>
                </li>,
              ];
            })}
          </ul>
        ) : null}
      </aside>
      <section className={!selected ? "hidden md:block" : undefined}>
        <TagChannelView tag={selected} />
      </section>
    </div>
  );
}
