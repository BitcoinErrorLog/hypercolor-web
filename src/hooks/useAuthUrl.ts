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
  // Session resume / receiver-publish budgets also say "timed out", but the
  // pubkyauth flow itself is still valid — regenerating the URL would discard
  // a grant Ring already approved.
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

/**
 * Port of pubky-app `useAuthUrl`: auto-fetch, expiry → regenerate,
 * approval survives unmount, starting a new flow cancels the previous one.
 * A cancelled flow that later resolves signs the orphan session out.
 */
export function useAuthUrl(options: UseAuthUrlOptions = {}): UseAuthUrlReturn {
  const autoFetch = options.autoFetch ?? true;
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const isMountedRef = useRef(true);
  const flowRef = useRef<{
    handle: AuthFlowHandle;
    canceled: boolean;
  } | null>(null);
  const onApprovedRef = useRef(options.onApproved);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onApprovedRef.current = options.onApproved;
    onErrorRef.current = options.onError;
  }, [options.onApproved, options.onError]);

  const cancelCurrentFlow = useCallback(() => {
    if (flowRef.current) {
      flowRef.current.canceled = true;
    }
  }, []);

  const fetchUrl = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setIsExpired(false);
    setUrl("");
    cancelCurrentFlow();

    try {
      const flow = await PaykitLinkWeb.startAuthFlow(RING_GRANT_CAPABILITIES);
      const tracked = { handle: flow, canceled: false };
      flowRef.current = tracked;
      const authorizationUrl = flow.authorizationUrl();

      void PaykitLinkWeb.awaitAuthApproval(flow)
        .then(async (session: SessionHandle) => {
          if (tracked.canceled) {
            try {
              await PaykitLinkWeb.signOutSession(session);
            } catch {
              try {
                session.free();
              } catch {
                // already consumed
              }
            }
            return;
          }
          const live = await adoptApprovedSession(session);
          await onApprovedRef.current?.(live.handle);
        })
        .catch((error: unknown) => {
          if (isCanceledError(error) || tracked.canceled) return;
          if (!isMountedRef.current) return;
          if (isAuthFlowExpiredError(error)) {
            setUrl("");
            setIsExpired(true);
            return;
          }
          onErrorRef.current?.(error);
        });

      if (!isMountedRef.current) return;
      setUrl(authorizationUrl ?? "");
    } catch (error) {
      if (!isMountedRef.current) return;
      onErrorRef.current?.(error);
    } finally {
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
