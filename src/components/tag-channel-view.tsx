"use client";

import { useEffect, useState } from "react";
import { sanitizePublicName, sanitizePublicPost, sanitizePublicTag } from "@/lib/public-text";
import { formatRelativeTime, shortPubky } from "@/lib/format";
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
  const [posts, setPosts] = useState<NexusPublicPost[]>([]);
  const [unavailable, setUnavailable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

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
            : "The public index is unreachable or returned unusable data. This is not your message history.",
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
    <article className="space-y-4" data-testid="tagChannelView">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Public topic</p>
        <h2 className="text-xl font-semibold">#{sanitizePublicTag(tag)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Opening this view is a public read. The index operator sees this tag lookup. These
          posts are world-readable. They are not a Hypercolor chat.
        </p>
      </div>
      <div
        className="rounded-md border border-border bg-card p-4"
        data-testid="tagChannelComposerDisabled"
      >
        <p className="text-sm font-medium">Posting is disabled</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Posting here publishes to the public graph. Publishing is not available in this
          release.
        </p>
        <button
          type="button"
          disabled
          className="mt-3 inline-flex h-8 items-center rounded-md bg-secondary px-3 text-xs text-muted-foreground opacity-60"
        >
          Write a public post
        </button>
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
