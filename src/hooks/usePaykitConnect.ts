"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HANDOFF_TTL_MS,
  pendingChannelMatches,
  startPaykitConnect,
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
import {
  watchCombinedGrant,
  type CombinedWatchResult,
} from "@/services/singleApproval";

export { resetPaykitConnectLive, resetPaykitConnectLiveForTests };

export type UsePaykitConnectOptions = {
  autoStart?: boolean;
  onResult?: (result: CombinedWatchResult) => Promise<void> | void;
  onProgress?: (stage: "locator" | "auth") => void;
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
  const onResultRef = useRef(options.onResult);
  const onProgressRef = useRef(options.onProgress);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  useEffect(() => {
    onResultRef.current = options.onResult;
    onProgressRef.current = options.onProgress;
    onErrorRef.current = options.onError;
    setLivePaykitConnectHandlers({
      onResult: options.onResult,
      onProgress: options.onProgress,
      onError: options.onError,
    });
  }, [options.onResult, options.onProgress, options.onError]);

  const bindWatch = useCallback((live: NonNullable<ReturnType<typeof getLivePaykitConnect>>) => {
    void watchCombinedGrant({
      ch: live.started.ch,
      deadlineMs: live.started.deadlineMs,
      flow: live.authFlow,
      signal: live.abort.signal,
      onProgress: (stage) => {
        const handlers = getLivePaykitConnectHandlers();
        (handlers.onProgress ?? onProgressRef.current)?.(stage);
      },
    })
      .then(async (result) => {
        settleLivePaykitConnect(live);
        if (live.abort.signal.aborted && result.kind !== "aborted") return;
        const handlers = getLivePaykitConnectHandlers();
        await (handlers.onResult ?? onResultRef.current)?.(result);
        if (result.kind === "timeout" && mountedRef.current) {
          setIsExpired(true);
        }
      })
      .catch((error: unknown) => {
        settleLivePaykitConnect(live);
        if (live.abort.signal.aborted || live.authFlow.canceled) return;
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
      if (currentLive) {
        currentLive.authFlow.canceled = true;
        currentLive.abort.abort();
      }
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
        const nextLive = {
          started: next,
          abort,
          authFlow: { handle: next.authFlow, canceled: false },
        };
        setLivePaykitConnect(nextLive);
        bindWatch(nextLive);
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
    [bindWatch],
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
      const nextLive = {
        started: current,
        abort: new AbortController(),
        authFlow: live?.authFlow ?? { handle: current.authFlow, canceled: false },
      };
      setLivePaykitConnect(nextLive);
      bindWatch(nextLive);
      if (mountedRef.current) {
        setStarted(current);
        setIsExpired(false);
        setIsLoading(false);
      }
      return;
    }
    await start({ replace: true });
  }, [bindWatch, start, started]);

  const copyUrl = useCallback(async () => {
    if (!started) return;
    await navigator.clipboard.writeText(started.url);
  }, [started]);

  const cancel = useCallback(() => {
    const live = getLivePaykitConnect();
    const ch = live?.started.ch ?? started?.ch;
    if (live) {
      live.authFlow.canceled = true;
      live.abort.abort();
    }
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
