"use client";

import { useEffect, useState } from "react";

export function gifProxyLooksConfigured(status: number): boolean {
  return status !== 503 && status !== 404 && status !== 401;
}

export function useGifConfigured(): boolean {
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/gif/search?q=")
      .then((res) => {
        if (cancelled) return;
        setConfigured(gifProxyLooksConfigured(res.status));
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
