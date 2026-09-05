"use client";

import { useEffect, useState } from "react";
import {
  classifyHandoffMode,
  decryptPendingHandoff,
  HANDOFF_MODE_COMBINED,
  HANDOFF_MODE_LEGACY,
  pendingChannelMatches,
  publishHandoffParamsToRelay,
  sanitizeHandoffError,
  validateHandoffPublicParams,
  type HandoffPayload,
  type HandoffPublicParams,
} from "@/services/RingConnect";
import { KeyStore } from "@/services/KeyStore";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "@/components/error-details";
import { getLivePaykitConnect } from "@/services/paykitConnectLive";
import { getLiveSession } from "@/services/link/session";
import { finishLegacyChainedGrant, finishSingleApproval } from "@/services/singleApproval";

const RING_CALLBACK_KEYSTORE_ERROR = "Could not open the key store.";
const RING_CALLBACK_HANDOFF_ERROR = "Could not complete this Ring handoff.";
const RING_CALLBACK_RELAY_ERROR = "Could not notify the waiting computer.";

export type RingCallbackPhase =
  | { kind: "reading" }
  | { kind: "invalid"; reason: string }
  | { kind: "relay-forwarded" }
  | {
      kind: "confirm";
      pubky: string;
      params: HandoffPublicParams;
      payload: HandoffPayload;
    }
  | { kind: "done"; pubky: string }
  | { kind: "error"; fallback: string; details: string | null };

function readParamsFromLocation(): {
  ch: string | null;
  params: ReturnType<typeof validateHandoffPublicParams>;
} {
  const search = new URLSearchParams(window.location.search);
  const ch = search.get("ch");
  return {
    ch,
    params: validateHandoffPublicParams({
      pubky: search.get("pubky"),
      request_id: search.get("request_id"),
      mode: search.get("mode"),
      homeserver: search.get("homeserver"),
    }),
  };
}

function liveTrackedSession() {
  const live = getLivePaykitConnect();
  if (live && !live.authFlow.canceled && live.authFlow.session) {
    return live.authFlow.session;
  }
  return getLiveSession()?.handle ?? null;
}

async function completeSameDeviceAdopt(
  params: HandoffPublicParams,
  payload: HandoffPayload,
  ch: string | undefined,
): Promise<{ pubky: string; homeserver: string } | null> {
  const mode = classifyHandoffMode(params.mode);
  const session = liveTrackedSession();
  if (!ch) {
    throw new Error("Missing channel id (ch).");
  }
  if (mode === HANDOFF_MODE_COMBINED) {
    if (!session) {
      throw new Error("No live session from this approval. Return to Welcome and finish the QR flow.");
    }
    return finishSingleApproval({ params, payload, session, ch });
  }
  if (mode === HANDOFF_MODE_LEGACY) {
    if (!session) {
      throw new Error("No live session cookie. Approve the chained grant first.");
    }
    return finishLegacyChainedGrant({ params, payload, session, ch });
  }
  throw new Error("Unknown handoff mode.");
}

export function RingCallbackPage({ fixturePhase }: { fixturePhase?: RingCallbackPhase } = {}) {
  const [livePhase, setPhase] = useState<RingCallbackPhase>({ kind: "reading" });
  const phase = fixturePhase ?? livePhase;

  useEffect(() => {
    if (fixturePhase) return;
    let cancelled = false;
    void (async () => {
      const { ch, params } = readParamsFromLocation();
      if (!ch) {
        if (!cancelled) {
          setPhase({ kind: "invalid", reason: "Missing channel id (ch)." });
        }
        return;
      }
      try {
        await KeyStore.initKeyStore();
      } catch (error) {
        if (!cancelled) {
          setPhase({
            kind: "error",
            fallback: RING_CALLBACK_KEYSTORE_ERROR,
            details: sanitizeHandoffError(error),
          });
        }
        return;
      }
      if (!params) {
        if (!cancelled) {
          setPhase({
            kind: "invalid",
            reason: "Callback is missing pubky, request_id, mode, or homeserver.",
          });
        }
        return;
      }

      const sameDevice = await pendingChannelMatches(ch);
      if (cancelled) return;
      if (sameDevice) {
        try {
          const payload = await decryptPendingHandoff(params, ch);
          if (!cancelled) {
            setPhase({
              kind: "confirm",
              pubky: params.pubky,
              params,
              payload,
            });
          }
        } catch (error) {
          if (!cancelled) {
            setPhase({
              kind: "error",
              fallback: RING_CALLBACK_HANDOFF_ERROR,
              details: sanitizeHandoffError(error),
            });
          }
        }
        return;
      }

      try {
        await publishHandoffParamsToRelay(ch, params);
        if (!cancelled) setPhase({ kind: "relay-forwarded" });
      } catch (error) {
        if (!cancelled) {
          setPhase({
            kind: "error",
            fallback: RING_CALLBACK_RELAY_ERROR,
            details: sanitizeHandoffError(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fixturePhase]);

  async function adopt() {
    if (phase.kind !== "confirm") return;
    try {
      const { ch } = readParamsFromLocation();
      const session = liveTrackedSession();
      const mode = classifyHandoffMode(phase.params.mode);
      if (mode !== HANDOFF_MODE_COMBINED && mode !== HANDOFF_MODE_LEGACY) {
        throw new Error("Unknown handoff mode.");
      }
      if (!session) {
        throw new Error(
          mode === HANDOFF_MODE_COMBINED
            ? "No live session from this approval. Return to Welcome and finish the QR flow."
            : "No live session cookie. Approve the chained grant first.",
        );
      }
      const { getTabLock, initTabLock, requestTakeoverAndWait } = await import(
        "@/services/tabLock"
      );
      await initTabLock();
      if (getTabLock().mode !== "writer") {
        await requestTakeoverAndWait();
      }
      const result = await completeSameDeviceAdopt(phase.params, phase.payload, ch ?? undefined);
      if (result) {
        setPhase({ kind: "done", pubky: result.pubky });
      }
    } catch (error) {
      setPhase({
        kind: "error",
        fallback: RING_CALLBACK_HANDOFF_ERROR,
        details: sanitizeHandoffError(error),
      });
    }
  }

  return (
    <article className="space-y-4" data-surface="ring-callback-page">
      <h1 className="text-2xl font-semibold tracking-tight">Ring callback</h1>

      {phase.kind === "reading" ? (
        <p className="text-sm text-muted-foreground">Reading return URL…</p>
      ) : null}

      {phase.kind === "relay-forwarded" ? (
        <p className="text-muted-foreground leading-7" data-testid="ringCallbackRelayDone">
          Approved — return to your computer.
        </p>
      ) : null}

      {phase.kind === "confirm" ? (
        <div className="space-y-3" data-testid="ringCallbackConfirm">
          <p className="leading-7">
            Continue as <code className="break-all font-mono">{phase.pubky}</code>?
          </p>
          <Button type="button" onClick={() => void adopt()}>
            Continue
          </Button>
        </div>
      ) : null}

      {phase.kind === "done" ? (
        <p className="text-muted-foreground leading-7">
          Identity stored for{" "}
          <code className="break-all font-mono">{phase.pubky}</code>. Continue to{" "}
          <a href="/enable" className="underline underline-offset-4">
            Enable messaging
          </a>
          .
        </p>
      ) : null}

      {phase.kind === "invalid" ? (
        <ErrorDetails fallback={phase.reason} details={null} />
      ) : null}

      {phase.kind === "error" ? (
        <ErrorDetails fallback={phase.fallback} details={phase.details} />
      ) : null}
    </article>
  );
}
