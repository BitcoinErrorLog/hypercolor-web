"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TagChannelView } from "@/components/tag-channel-view";
import { usePathSegment } from "@/hooks/usePathSegment";
import { sanitizePublicTag } from "@/lib/public-text";
import { encodeTagPath } from "@/lib/tag-channel";
import { TagChannelReader } from "@/services/nexus/tagChannel";
import type { NexusHotTag } from "@/services/nexus/NexusDiscoveryClient";

export function DiscoverPage() {
  const selected = usePathSegment("discover");
  const [tags, setTags] = useState<NexusHotTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void TagChannelReader.loadDirectory().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setTags([]);
        setError(
          "The public index is unreachable or returned unusable data. Private chats are not listed here.",
        );
        return;
      }
      setError(null);
      setTags(result.tags);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="grid min-h-[70vh] gap-6 md:grid-cols-[minmax(16rem,20rem)_1fr]"
      data-testid="discoverScreen"
    >
      <aside className={selected ? "hidden md:block" : undefined}>
        <h1 className="text-2xl font-semibold tracking-tight">Discover</h1>
        <p className="mt-2 text-sm text-muted-foreground" data-testid="discoverPrivacyCopy">
          This is the global public index — rooms anyone can already query. Opening a topic
          is a public read; the index operator sees which tags you look up. Private DMs and
          groups stay on Chats and Channels and are never sent here. Skip this page if you
          do not want that query to happen.
        </p>
        {loading ? <p className="mt-6 text-sm text-muted-foreground">Loading topics…</p> : null}
        {error ? (
          <p className="mt-6 text-sm text-red-400" data-testid="discoverError">
            {error}
          </p>
        ) : null}
        {!loading && !error && tags.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground" data-testid="discoverEmpty">
            The public index has no hot tags right now.
          </p>
        ) : null}
        {tags.length > 0 ? (
          <ul className="mt-4 divide-y divide-border" data-testid="discoverHotTags">
            {tags.map((tag) => (
              <li key={tag.label}>
                <Link
                  href={`/discover/${encodeTagPath(tag.label)}`}
                  data-testid="discoverTagRow"
                  className="block py-3 hover:bg-accent/40"
                >
                  <span className="font-medium">#{sanitizePublicTag(tag.label)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {tag.taggedCount} posts · {tag.taggersCount} taggers
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </aside>
      <section className={!selected ? "hidden md:block" : undefined}>
        <TagChannelView tag={selected} />
      </section>
    </div>
  );
}
