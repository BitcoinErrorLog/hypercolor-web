"use client";

import { useSyncExternalStore } from "react";

type PathSegmentPageProps = {
  title: string;
  segment: "chats" | "channels";
};

function subscribe() {
  return () => {};
}

function readPathId(segment: string): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === segment && parts[1]) {
    return decodeURIComponent(parts[1]);
  }
  return null;
}

export function PathSegmentPage({ title, segment }: PathSegmentPageProps) {
  const pathId = useSyncExternalStore(
    subscribe,
    () => readPathId(segment),
    () => null,
  );

  const heading = pathId ? `${title} — ${pathId}` : title;

  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
      <p className="text-muted-foreground">
        {title} — coming online with your session.
      </p>
      {pathId ? (
        <p className="text-sm text-muted-foreground">
          This identity is read from the URL. The conversation body is not
          loaded until a homeserver session exists.
        </p>
      ) : null}
    </article>
  );
}
