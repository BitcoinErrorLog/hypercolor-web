"use client";

import { useEffect, useState } from "react";
import {
  adoptHandoff,
  decryptPendingHandoff,
  pendingChannelMatches,
  publishHandoffParamsToRelay,
  validateHandoffPublicParams,
  type HandoffPayload,
  type HandoffPublicParams,
} from "@/services/RingConnect";
import { KeyStore } from "@/services/KeyStore";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "@/components/error-details";

const RING_CALLBACK_KEYSTORE_ERROR = "Could not open the key store.";
const RING_CALLBACK_HANDOFF_ERROR = "Could not complete this Ring handoff.";
const RING_CALLBACK_RELAY_ERROR = "Could not notify the waiting computer.";

type Phase =
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

export function RingCallbackPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });

  useEffect(() => {
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
            details: error instanceof Error ? error.message : "KeyStore failed to open",
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
          const payload = await decryptPendingHandoff(params);
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
              details: error instanceof Error ? error.message : "Handoff failed",
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
            details:
              error instanceof Error
                ? error.message
                : "Failed to notify the waiting computer.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function adopt() {
    if (phase.kind !== "confirm") return;
    try {
      const result = await adoptHandoff(phase.params, phase.payload);
      if (result) {
        setPhase({ kind: "done", pubky: result.pubky });
      }
    } catch (error) {
      setPhase({
        kind: "error",
        fallback: RING_CALLBACK_HANDOFF_ERROR,
        details: error instanceof Error ? error.message : "Handoff failed",
      });
    }
  }

  return (
    <article className="space-y-4">
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
