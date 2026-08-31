"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import {
  PaykitLinkWeb,
  type AuthFlowHandle,
  type SessionHandle,
} from "@/services/link/PaykitLinkWeb";
import { adoptApprovedSession } from "@/services/link/session";

export const AUTH_FLOW_CANCELED_ERROR_NAME = "AuthFlowCanceled";
export const ENABLE_AFTER_APPROVAL_BUDGET_MS = 30_000;

export type UseAuthUrlOptions = {
  autoFetch?: boolean;
  onApproved?: (session: SessionHandle) => Promise<void> | void;
  onError?: (error: unknown) => void;
};

export type UseAuthUrlReturn = {
  url: string;
  isLoading: boolean;
  isExpired: boolean;
  fetchUrl: () => Promise<void>;
  copyAuthUrl: () => Promise<void>;
};

function isAuthFlowExpiredError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message) : "";
  if (name === "TimeoutError" || name === "SESSION_EXPIRED") return true;
  if (name === "SessionResumeTimeout") return false;
  return /timeout|expired|SESSION_EXPIRED/i.test(`${name} ${message}`);
}

function isCanceledError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === AUTH_FLOW_CANCELED_ERROR_NAME
  );
}

async function withBudget<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error(`${label} timed out after ${ms}ms`), {
              name: "SessionResumeTimeout",
            }),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type TrackedAuthFlow = {
  handle: AuthFlowHandle;
  url: string;
  canceled: boolean;
};

/** Survives Enable remount / Fast Refresh so a second fetch cannot start a
 * replacement pubkyauth flow after `awaitApproval` has consumed the handle. */
let sharedFlow: TrackedAuthFlow | null = null;
let startInFlight: Promise<void> | null = null;

async function signOutQuietly(session: SessionHandle): Promise<void> {
  try {
    await PaykitLinkWeb.signOutSession(session);
  } catch {
    try {
      session.free();
    } catch {
      // already consumed
    }
  }
}

function reportApprovalError(
  error: unknown,
  opts: {
    canceled: boolean;
    isMounted: boolean;
    onError?: (error: unknown) => void;
    onExpired: () => void;
  },
): void {
  if (isCanceledError(error) || opts.canceled) return;
  opts.onError?.(error);
  if (!opts.isMounted) return;
  if (isAuthFlowExpiredError(error)) opts.onExpired();
}

/**
 * Port of pubky-app `useAuthUrl`: auto-fetch, expiry → regenerate,
 * approval survives unmount. An in-flight pubkyauth flow is reused by its
 * stored URL; `awaitApproval` consumes the wasm handle, so a second fetch
 * must not cancel that flow or the approved session is signed out.
 */
export function useAuthUrl(options: UseAuthUrlOptions = {}): UseAuthUrlReturn {
  const autoFetch = options.autoFetch ?? true;
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const isMountedRef = useRef(true);
  const onApprovedRef = useRef(options.onApproved);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onApprovedRef.current = options.onApproved;
    onErrorRef.current = options.onError;
  }, [options.onApproved, options.onError]);

  const cancelCurrentFlow = useCallback(() => {
    if (sharedFlow) {
      sharedFlow.canceled = true;
    }
  }, []);

  const fetchUrl = useCallback(async (): Promise<void> => {
    const reuse = (): boolean => {
      const existing = sharedFlow;
      if (!existing || existing.canceled) return false;
      if (isMountedRef.current) {
        setUrl(existing.url);
        setIsLoading(false);
        setIsExpired(false);
      }
      return true;
    };
    if (reuse()) return;
    if (startInFlight) {
      await startInFlight;
      if (reuse()) return;
    }

    let done!: () => void;
    startInFlight = new Promise<void>((resolve) => {
      done = resolve;
    });

    setIsLoading(true);
    setIsExpired(false);
    setUrl("");
    cancelCurrentFlow();

    try {
      const flow = await PaykitLinkWeb.startAuthFlow(RING_GRANT_CAPABILITIES);
      const authorizationUrl = flow.authorizationUrl() ?? "";
      const tracked: TrackedAuthFlow = {
        handle: flow,
        url: authorizationUrl,
        canceled: false,
      };
      sharedFlow = tracked;

      void PaykitLinkWeb.awaitAuthApproval(flow)
        .then(async (session: SessionHandle) => {
          if (tracked.canceled) {
            await signOutQuietly(session);
            return;
          }
          console.info("[hypercolor enable] auth approved, adopting session");
          await withBudget(
            (async () => {
              const live = await adoptApprovedSession(session);
              console.info("[hypercolor enable] session adopted, provisioning");
              await onApprovedRef.current?.(live.handle);
              console.info("[hypercolor enable] onApproved finished");
            })(),
            ENABLE_AFTER_APPROVAL_BUDGET_MS,
            "enable after Ring approval",
          );
        })
        .catch((error: unknown) => {
          reportApprovalError(error, {
            canceled: tracked.canceled,
            isMounted: isMountedRef.current,
            onError: onErrorRef.current,
            onExpired: () => {
              setUrl("");
              setIsExpired(true);
            },
          });
        });

      if (!isMountedRef.current) return;
      setUrl(authorizationUrl);
    } catch (error) {
      onErrorRef.current?.(error);
    } finally {
      done();
      startInFlight = null;
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [cancelCurrentFlow]);

  const copyAuthUrl = useCallback(async (): Promise<void> => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
  }, [url]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!autoFetch) return;
    const timer = window.setTimeout(() => {
      void fetchUrl();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoFetch, fetchUrl]);

  return {
    url,
    isLoading,
    isExpired,
    fetchUrl,
    copyAuthUrl,
  };
}
