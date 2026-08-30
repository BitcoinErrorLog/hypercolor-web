"use client";

import { useSyncExternalStore } from "react";

type QueryEntry = {
  key: string;
  value: string;
};

function subscribe() {
  return () => {};
}

function readSearch(): string {
  return window.location.search;
}

function serverSearch(): string | null {
  return null;
}

export default function RingCallbackPage() {
  const search = useSyncExternalStore(subscribe, readSearch, serverSearch);
  const entries: QueryEntry[] | null =
    search === null
      ? null
      : [...new URLSearchParams(search).entries()].map(([key, value]) => ({
          key,
          value,
        }));

  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Ring callback</h1>
      <p className="text-muted-foreground leading-7">
        Pubky Ring returns here after you approve a session. This page reads{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
          window.location.search
        </code>
        . No session is stored yet — that wiring is a later wave.
      </p>
      {entries === null ? (
        <p className="text-sm text-muted-foreground">Reading return URL…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No query string on this visit.
        </p>
      ) : (
        <dl className="space-y-2 rounded-md border border-border bg-card p-4 text-sm">
          {entries.map((entry) => (
            <div key={`${entry.key}:${entry.value}`}>
              <dt className="font-mono text-muted-foreground">{entry.key}</dt>
              <dd className="break-all font-mono">{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
