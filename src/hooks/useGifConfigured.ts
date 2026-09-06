"use client";

import { useEffect, useState } from "react";

export function useGifConfigured(): boolean {
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/gif/search?q=")
      .then((res) => {
        if (cancelled) return;
        setConfigured(res.status !== 503 && res.status !== 404);
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
