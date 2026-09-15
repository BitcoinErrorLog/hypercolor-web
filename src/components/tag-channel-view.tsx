"use client";

import { useEffect, useRef, useState } from "react";
import { DetailBackLink } from "@/components/detail-back";
import { DetailHeading } from "@/components/detail-heading";
import { sanitizePublicName, sanitizePublicPost, sanitizePublicTag } from "@/lib/public-text";
import { formatRelativeTime, shortPubky } from "@/lib/format";
import { PUBLIC_GRAPH_WARNING } from "@/lib/session-ui";
import { TagChannelReader } from "@/services/nexus/tagChannel";
import type { NexusPublicPost } from "@/services/nexus/NexusDiscoveryClient";

export type TagChannelFixture = {
  posts: NexusPublicPost[];
  unavailable: number;
  loading: boolean;
  error: string | null;
  empty: boolean;
};

export function TagChannelView({
  tag,
  fixture,
  now,
}: {
  tag: string | null;
  fixture?: TagChannelFixture;
  now?: number;
}) {
  if (!tag) {
    return (
      <p className="text-sm text-muted-foreground" data-surface="tag-channel-view">
        Open a public topic to read posts the index already has.
      </p>
    );
  }
  return <TagChannelTimeline key={tag} tag={tag} fixture={fixture} now={now} />;
}

function TagChannelTimeline({ tag, fixture, now }: { tag: string; fixture?: TagChannelFixture; now?: number }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [posts, setPosts] = useState<NexusPublicPost[]>(fixture?.posts ?? []);
  const [unavailable, setUnavailable] = useState(fixture?.unavailable ?? 0);
  const [loading, setLoading] = useState(fixture?.loading ?? true);
  const [error, setError] = useState<string | null>(fixture?.error ?? null);
  const [empty, setEmpty] = useState(fixture?.empty ?? false);

  useEffect(() => {
    headingRef.current?.focus();
  }, [tag]);

  useEffect(() => {
    if (fixture) return;
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
  }, [tag, fixture]);

  const visiblePosts = fixture?.posts ?? posts;
  const visibleUnavailable = fixture?.unavailable ?? unavailable;
  const visibleLoading = fixture?.loading ?? loading;
  const visibleError = fixture?.error ?? error;
  const visibleEmpty = fixture?.empty ?? empty;

  return (
    <article className="space-y-4" data-testid="tagChannelView" data-surface="tag-channel-view" aria-busy={visibleLoading || undefined}>
      <div>
        <DetailBackLink href="/channels?mode=public" listLabel="Channels" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Public topic</p>
        <DetailHeading headingRef={headingRef} className="text-xl font-semibold">
          #{sanitizePublicTag(tag)}
        </DetailHeading>
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
      {visibleLoading ? <p className="text-sm text-muted-foreground">Loading public posts…</p> : null}
      {visibleError ? (
        <p className="text-sm hc-danger-text" data-testid="tagChannelError">
          {visibleError}
        </p>
      ) : null}
      {visibleEmpty && !visibleLoading && !visibleError ? (
        <p className="text-sm text-muted-foreground" data-testid="tagChannelEmpty">
          No posts in this index for this tag.
        </p>
      ) : null}
      {visibleUnavailable > 0 && !visibleLoading ? (
        <p className="text-sm text-muted-foreground">
          {visibleUnavailable} indexed {visibleUnavailable === 1 ? "row" : "rows"} had no usable post body.
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {visiblePosts.map((post) => (
          <li key={`${post.author}:${post.postId}`} className="py-4" data-testid="tagChannelPost">
            <p className="font-medium">{sanitizePublicName(shortPubky(post.author))}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{post.author}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{sanitizePublicPost(post.content)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRelativeTime(post.indexedAt, now)}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}
