"use client";

import { useEffect, useRef, useState } from "react";
import { DetailBackLink } from "@/components/detail-back";
import { sanitizePublicName, sanitizePublicPost, sanitizePublicTag } from "@/lib/public-text";
import { formatRelativeTime, shortPubky } from "@/lib/format";
import { PUBLIC_GRAPH_WARNING } from "@/lib/session-ui";
import { TagChannelReader } from "@/services/nexus/tagChannel";
import type { NexusPublicPost } from "@/services/nexus/NexusDiscoveryClient";

export function TagChannelView({ tag }: { tag: string | null }) {
  if (!tag) {
    return (
      <p className="text-sm text-muted-foreground">
        Open a public topic to read posts the index already has.
      </p>
    );
  }
  return <TagChannelTimeline key={tag} tag={tag} />;
}

function TagChannelTimeline({ tag }: { tag: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [posts, setPosts] = useState<NexusPublicPost[]>([]);
  const [unavailable, setUnavailable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, [tag]);

  useEffect(() => {
    let cancelled = false;
    void TagChannelReader.loadTimeline(tag).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setPosts([]);
        setError(
          result.kind === "invalid"
            ? result.message
            : "Could not reach the public index.",
        );
        return;
      }
      setPosts(result.posts);
      setUnavailable(result.unavailable);
      setEmpty(result.posts.length === 0);
    });
    return () => {
      cancelled = true;
    };
  }, [tag]);

  return (
    <article className="space-y-4" data-testid="tagChannelView" aria-busy={loading || undefined}>
      <div>
        <DetailBackLink href="/channels?mode=public" listLabel="Channels" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Public topic</p>
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
          #{sanitizePublicTag(tag)}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{PUBLIC_GRAPH_WARNING}</p>
      </div>
      <div
        className="rounded-md border border-border bg-card p-4"
        data-testid="tagChannelComposerDisabled"
      >
        <p className="text-sm font-medium">Posting is not available here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Posting here publishes to the public graph. Publishing is not available in this
          release. This is not a private Hypercolor chat.
        </p>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading public posts…</p> : null}
      {error ? (
        <p className="text-sm text-red-400" data-testid="tagChannelError">
          {error}
        </p>
      ) : null}
      {empty && !loading && !error ? (
        <p className="text-sm text-muted-foreground" data-testid="tagChannelEmpty">
          No posts in this index for this tag.
        </p>
      ) : null}
      {unavailable > 0 && !loading ? (
        <p className="text-sm text-muted-foreground">
          {unavailable} indexed {unavailable === 1 ? "row" : "rows"} had no usable post body.
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {posts.map((post) => (
          <li key={`${post.author}:${post.postId}`} className="py-4" data-testid="tagChannelPost">
            <p className="font-medium">{sanitizePublicName(shortPubky(post.author))}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{post.author}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{sanitizePublicPost(post.content)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRelativeTime(post.indexedAt)}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}
