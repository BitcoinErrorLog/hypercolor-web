"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HANDOFF_TTL_MS,
  pendingChannelMatches,
  startPaykitConnect,
  waitForHandoffParams,
  type HandoffPublicParams,
  type PaykitConnectStart,
} from "@/services/RingConnect";
import { KeyStore } from "@/services/KeyStore";
import {
  getLivePaykitConnect,
  getLivePaykitConnectHandlers,
  getPaykitConnectStartLock,
  resetPaykitConnectLive,
  resetPaykitConnectLiveForTests,
  setLivePaykitConnect,
  setLivePaykitConnectHandlers,
  setPaykitConnectStartLock,
  settleLivePaykitConnect,
} from "@/services/paykitConnectLive";

export { resetPaykitConnectLive, resetPaykitConnectLiveForTests };

export type UsePaykitConnectOptions = {
  autoStart?: boolean;
  onParams?: (params: HandoffPublicParams, ch: string) => Promise<void> | void;
  onError?: (error: unknown) => void;
};

export type StartPaykitConnectOptions = {
  replace?: boolean;
};

function isUnexpired(started: PaykitConnectStart | null | undefined): started is PaykitConnectStart {
  return Boolean(started && started.deadlineMs > Date.now());
}

async function liveChannelIsReusable(started: PaykitConnectStart | null | undefined): Promise<boolean> {
  if (!isUnexpired(started)) return false;
  return pendingChannelMatches(started.ch);
}

export function usePaykitConnect(options: UsePaykitConnectOptions = {}) {
  const autoStart = options.autoStart ?? true;
  const [started, setStarted] = useState<PaykitConnectStart | null>(
    isUnexpired(getLivePaykitConnect()?.started) ? getLivePaykitConnect()!.started : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const mountedRef = useRef(true);
  const startedRef = useRef(started);
  const onParamsRef = useRef(options.onParams);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  useEffect(() => {
    onParamsRef.current = options.onParams;
    onErrorRef.current = options.onError;
    setLivePaykitConnectHandlers({
      onParams: options.onParams,
      onError: options.onError,
    });
  }, [options.onParams, options.onError]);

  const bindPoll = useCallback((live: NonNullable<ReturnType<typeof getLivePaykitConnect>>) => {
    void waitForHandoffParams(live.started.ch, live.started.deadlineMs, live.abort.signal)
      .then(async (params) => {
        settleLivePaykitConnect(live);
        if (live.abort.signal.aborted) return;
        const handlers = getLivePaykitConnectHandlers();
        await (handlers.onParams ?? onParamsRef.current)?.(params, live.started.ch);
      })
      .catch((error: unknown) => {
        settleLivePaykitConnect(live);
        if (live.abort.signal.aborted) return;
        const name =
          typeof error === "object" && error !== null && "name" in error
            ? String((error as { name?: unknown }).name)
            : "";
        if (name === "RelayPollExhaustedError" || Date.now() >= live.started.deadlineMs) {
          if (mountedRef.current) setIsExpired(true);
          return;
        }
        const handlers = getLivePaykitConnectHandlers();
        (handlers.onError ?? onErrorRef.current)?.(error);
      });
  }, []);

  const start = useCallback(
    async (startOptions: StartPaykitConnectOptions = {}) => {
      const replace = startOptions.replace === true;
      const live = getLivePaykitConnect();
      if (!replace && (await liveChannelIsReusable(live?.started))) {
        if (mountedRef.current && live) {
          setStarted(live.started);
          setIsExpired(false);
          setIsLoading(false);
        }
        return;
      }
      const existingLock = getPaykitConnectStartLock();
      if (!replace && existingLock) {
        await existingLock;
        const afterLock = getLivePaykitConnect();
        if ((await liveChannelIsReusable(afterLock?.started)) && mountedRef.current && afterLock) {
          setStarted(afterLock.started);
          setIsExpired(false);
          setIsLoading(false);
        }
        return;
      }
      if (replace && existingLock) {
        await existingLock;
      }

      let release: () => void = () => undefined;
      setPaykitConnectStartLock(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      const currentLive = getLivePaykitConnect();
      const previousCh = currentLive?.started.ch ?? (replace ? startedRef.current?.ch : undefined);
      currentLive?.abort.abort();
      if (replace && previousCh) {
        await KeyStore.clearPendingRingHandoff(previousCh);
      }
      const abort = new AbortController();
      if (mountedRef.current) {
        setIsLoading(true);
        setIsExpired(false);
        if (replace) setStarted(null);
      }
      try {
        const next = await startPaykitConnect();
        const nextLive = { started: next, abort };
        setLivePaykitConnect(nextLive);
        bindPoll(nextLive);
        if (mountedRef.current) {
          setStarted(next);
        }
      } catch (error) {
        if (mountedRef.current) onErrorRef.current?.(error);
      } finally {
        if (mountedRef.current) setIsLoading(false);
        release();
        setPaykitConnectStartLock(null);
      }
    },
    [bindPoll],
  );

  const showQrAgain = useCallback(async () => {
    const live = getLivePaykitConnect();
    const current = isUnexpired(live?.started)
      ? live.started
      : isUnexpired(started)
        ? started
        : null;
    if (current && (await pendingChannelMatches(current.ch))) {
      if (live && live.started.ch === current.ch) {
        if (mountedRef.current) {
          setStarted(current);
          setIsExpired(false);
          setIsLoading(false);
        }
        return;
      }
      const nextLive = { started: current, abort: new AbortController() };
      setLivePaykitConnect(nextLive);
      bindPoll(nextLive);
      if (mountedRef.current) {
        setStarted(current);
        setIsExpired(false);
        setIsLoading(false);
      }
      return;
    }
    await start({ replace: true });
  }, [bindPoll, start, started]);

  const copyUrl = useCallback(async () => {
    if (!started) return;
    await navigator.clipboard.writeText(started.url);
  }, [started]);

  const cancel = useCallback(() => {
    const live = getLivePaykitConnect();
    const ch = live?.started.ch ?? started?.ch;
    live?.abort.abort();
    setLivePaykitConnect(null);
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
    showQrAgain,
    copyUrl,
    cancel,
  };
}
