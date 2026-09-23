"use client";

import { useEffect, useState } from "react";

export function gifConfigSaysConfigured(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return (body as { configured?: unknown }).configured === true;
}

export function useGifConfigured(): boolean {
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/gif/config")
      .then(async (res) => {
        if (!res.ok) return false;
        return gifConfigSaysConfigured(await res.json());
      })
      .then((value) => {
        if (!cancelled) setConfigured(value === true);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return configured;
}
