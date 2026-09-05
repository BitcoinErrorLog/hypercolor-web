"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HANDOFF_TTL_MS,
  startPaykitConnect,
  waitForHandoffParams,
  type HandoffPublicParams,
  type PaykitConnectStart,
} from "@/services/RingConnect";
import { KeyStore } from "@/services/KeyStore";

export type UsePaykitConnectOptions = {
  autoStart?: boolean;
  onParams?: (params: HandoffPublicParams, ch: string) => Promise<void> | void;
  onError?: (error: unknown) => void;
};

export type StartPaykitConnectOptions = {
  replace?: boolean;
};

type LivePaykitConnect = {
  started: PaykitConnectStart;
  abort: AbortController;
};

let livePaykitConnect: LivePaykitConnect | null = null;
let startLock: Promise<void> | null = null;
let liveOnParams: UsePaykitConnectOptions["onParams"];
let liveOnError: UsePaykitConnectOptions["onError"];

export function resetPaykitConnectLiveForTests(): void {
  livePaykitConnect?.abort.abort();
  livePaykitConnect = null;
  startLock = null;
  liveOnParams = undefined;
  liveOnError = undefined;
}

function isUnexpired(started: PaykitConnectStart | null | undefined): started is PaykitConnectStart {
  return Boolean(started && started.deadlineMs > Date.now());
}

export function usePaykitConnect(options: UsePaykitConnectOptions = {}) {
  const autoStart = options.autoStart ?? true;
  const [started, setStarted] = useState<PaykitConnectStart | null>(
    isUnexpired(livePaykitConnect?.started) ? livePaykitConnect.started : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const mountedRef = useRef(true);
  const onParamsRef = useRef(options.onParams);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onParamsRef.current = options.onParams;
    onErrorRef.current = options.onError;
    liveOnParams = options.onParams;
    liveOnError = options.onError;
  }, [options.onParams, options.onError]);

  const bindPoll = useCallback((live: LivePaykitConnect) => {
    void waitForHandoffParams(live.started.ch, live.started.deadlineMs, live.abort.signal)
      .then(async (params) => {
        if (live.abort.signal.aborted) return;
        await (liveOnParams ?? onParamsRef.current)?.(params, live.started.ch);
      })
      .catch((error: unknown) => {
        if (live.abort.signal.aborted) return;
        const name =
          typeof error === "object" && error !== null && "name" in error
            ? String((error as { name?: unknown }).name)
            : "";
        if (name === "RelayPollExhaustedError" || Date.now() >= live.started.deadlineMs) {
          if (mountedRef.current) setIsExpired(true);
          return;
        }
        (liveOnError ?? onErrorRef.current)?.(error);
      });
  }, []);

  const start = useCallback(
    async (startOptions: StartPaykitConnectOptions = {}) => {
      const replace = startOptions.replace === true;
      if (!replace && isUnexpired(livePaykitConnect?.started)) {
        if (mountedRef.current) {
          setStarted(livePaykitConnect.started);
          setIsExpired(false);
          setIsLoading(false);
        }
        return;
      }
      if (!replace && startLock) {
        await startLock;
        if (isUnexpired(livePaykitConnect?.started) && mountedRef.current) {
          setStarted(livePaykitConnect.started);
          setIsExpired(false);
          setIsLoading(false);
        }
        return;
      }
      if (replace && startLock) {
        await startLock;
      }

      let release: () => void = () => undefined;
      startLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      livePaykitConnect?.abort.abort();
      const abort = new AbortController();
      if (mountedRef.current) {
        setIsLoading(true);
        setIsExpired(false);
        if (replace) setStarted(null);
      }
      try {
        const next = await startPaykitConnect();
        livePaykitConnect = { started: next, abort };
        bindPoll(livePaykitConnect);
        if (mountedRef.current) {
          setStarted(next);
        }
      } catch (error) {
        if (mountedRef.current) onErrorRef.current?.(error);
      } finally {
        if (mountedRef.current) setIsLoading(false);
        release();
        startLock = null;
      }
    },
    [bindPoll],
  );

  const copyUrl = useCallback(async () => {
    if (!started) return;
    await navigator.clipboard.writeText(started.url);
  }, [started]);

  const cancel = useCallback(() => {
    const ch = livePaykitConnect?.started.ch ?? started?.ch;
    livePaykitConnect?.abort.abort();
    livePaykitConnect = null;
    if (ch) {
      void KeyStore.clearPendingRingHandoff(ch);
    }
    setStarted(null);
    setIsExpired(false);
    setIsLoading(false);
  }, [started?.ch]);

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
    cancel,
  };
}
