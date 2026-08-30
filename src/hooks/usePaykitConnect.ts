"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HANDOFF_TTL_MS,
  startPaykitConnect,
  waitForHandoffParams,
  type HandoffPublicParams,
  type PaykitConnectStart,
} from "@/services/RingConnect";

export type UsePaykitConnectOptions = {
  autoStart?: boolean;
  onParams?: (params: HandoffPublicParams) => Promise<void> | void;
  onError?: (error: unknown) => void;
};

export function usePaykitConnect(options: UsePaykitConnectOptions = {}) {
  const autoStart = options.autoStart ?? true;
  const [started, setStarted] = useState<PaykitConnectStart | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const onParamsRef = useRef(options.onParams);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onParamsRef.current = options.onParams;
    onErrorRef.current = options.onError;
  }, [options.onParams, options.onError]);

  const start = useCallback(async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setIsLoading(true);
    setIsExpired(false);
    setStarted(null);
    try {
      const next = await startPaykitConnect();
      if (!mountedRef.current) return;
      setStarted(next);
      void waitForHandoffParams(next.ch, next.deadlineMs, abort.signal)
        .then(async (params) => {
          if (abort.signal.aborted) return;
          await onParamsRef.current?.(params);
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted) return;
          if (!mountedRef.current) return;
          const name =
            typeof error === "object" && error !== null && "name" in error
              ? String((error as { name?: unknown }).name)
              : "";
          if (name === "RelayPollExhaustedError" || Date.now() >= next.deadlineMs) {
            setIsExpired(true);
            return;
          }
          onErrorRef.current?.(error);
        });
    } catch (error) {
      if (mountedRef.current) onErrorRef.current?.(error);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  const copyUrl = useCallback(async () => {
    if (!started) return;
    await navigator.clipboard.writeText(started.url);
  }, [started]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!autoStart) return;
    const timer = window.setTimeout(() => {
      void start();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [autoStart, start]);

  useEffect(() => {
    if (!started || isExpired) return;
    const remaining = Math.max(0, started.deadlineMs - Date.now());
    const timer = window.setTimeout(
      () => setIsExpired(true),
      Math.min(remaining, HANDOFF_TTL_MS),
    );
    return () => window.clearTimeout(timer);
  }, [started, isExpired]);

  return {
    url: started?.url ?? "",
    ch: started?.ch ?? "",
    isLoading,
    isExpired,
    start,
    copyUrl,
  };
}
