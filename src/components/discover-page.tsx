"use client";

import Link from "next/link";
import { useState } from "react";
import { DetailBackLink, rememberAndOpen } from "@/components/detail-back";
import { Button } from "@/components/ui/button";
import { PUBLIC_GRAPH_WARNING, PUBLIC_SUBSTRATE_LINE } from "@/lib/session-ui";
import { sanitizePublicTag } from "@/lib/public-text";
import { encodeTagPath, normalizeTagLabel } from "@/lib/tag-channel";
import { topicRowDomId } from "@/lib/list-detail-focus";
import { TagChannelReader } from "@/services/nexus/tagChannel";
import type { NexusHotTag } from "@/services/nexus/NexusDiscoveryClient";
import {
  createDiscoverTopicsLoader,
  type DiscoverTopicsView,
  initialDiscoverTopicsView,
} from "./discover-topics";

export function topicHref(tag: string): string {
  return `/channels/${encodeTagPath(tag)}?mode=public`;
}

export function PublicTopicsPanel({
  selectedTag,
  fixture,
}: {
  selectedTag: string | null;
  fixture?: DiscoverTopicsView;
}) {
  const [loader] = useState(() =>
    createDiscoverTopicsLoader(() => TagChannelReader.loadDirectory()),
  );
  const initial = fixture ?? initialDiscoverTopicsView();
  const [tags, setTags] = useState<NexusHotTag[]>(initial.tags);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(initial.loaded);
  const [error, setError] = useState<string | null>(initial.error);

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
    <div data-testid="discoverScreen" data-surface="discover-page">
      <p className="mt-2 text-sm text-muted-foreground" data-testid="discoverPrivacyCopy">
        {PUBLIC_GRAPH_WARNING}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{PUBLIC_SUBSTRATE_LINE}</p>
      {!loaded ? (
        <Button
          type="button"
          size="sm"
          className="mt-6"
          disabled={loading}
          data-testid="discoverLoadTopics"
          onClick={() => void loadTopics()}
        >
          {loading ? "Loading topics…" : error ? "Try again" : "Load public topics"}
        </Button>
      ) : null}
      {error ? (
        <p className="mt-6 text-sm hc-danger-text" data-testid="discoverError">
          Could not reach the public index.
        </p>
      ) : null}
      {loaded && !error && tags.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground" data-testid="discoverEmpty">
          The public index has no topics right now.
        </p>
      ) : null}
      {tags.length > 0 ? (
        <ul className="mt-4 divide-y divide-border" data-testid="discoverHotTags">
          {tags.flatMap((tag) => {
            const label = normalizeTagLabel(tag.label);
            if (!label) return [];
            const rowId = topicRowDomId(label);
            return [
              <li key={label}>
                <Link
                  id={rowId}
                  href={topicHref(label)}
                  data-testid="discoverTagRow"
                  className="block min-h-11 py-3 hover:bg-accent"
                  onClick={() => rememberAndOpen("channels", rowId)}
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
      {selectedTag ? (
        <div className="mt-6 md:hidden">
          <DetailBackLink href="/channels?mode=public" listLabel="Channels" />
        </div>
      ) : null}
    </div>
  );
}
