import {
  HANDOFF_MODE_COMBINED,
  HANDOFF_MODE_LEGACY,
  classifyHandoffMode,
  decryptPendingHandoff,
  pendingChannelMatches,
  rememberPendingHandoffLocator,
  waitForHandoffParams,
  adoptHandoff,
  type HandoffPayload,
  type HandoffPublicParams,
} from "@/services/RingConnect";
import { PaykitLinkWeb, type AuthFlowHandle, type SessionHandle } from "@/services/link/PaykitLinkWeb";
import { adoptApprovedSession, wipeSessionMetadata } from "@/services/link/session";
import { provisionReceiver } from "@/services/link/provisionReceiver";
import { useAuthStore } from "@/stores/authStore";

export type TrackedAuthFlow = {
  handle: AuthFlowHandle;
  canceled: boolean;
  session?: SessionHandle;
};

export type CombinedWatchResult =
  | {
      kind: "combined";
      params: HandoffPublicParams;
      payload: HandoffPayload;
      session: SessionHandle;
      ch: string;
    }
  | {
      kind: "legacy";
      params: HandoffPublicParams;
      payload: HandoffPayload;
      ch: string;
    }
  | { kind: "locator_missing"; session: SessionHandle }
  | { kind: "auth_missing"; params: HandoffPublicParams }
  | { kind: "timeout" }
  | { kind: "aborted" };

export type CombinedWatchProgress = "locator" | "auth";

export class BindingMismatchError extends Error {
  override name = "BindingMismatchError";
}

export class ProvisionReceiverFailedError extends Error {
  override name = "ProvisionReceiverFailedError";
}

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

export async function watchCombinedGrant(input: {
  ch: string;
  deadlineMs: number;
  flow: TrackedAuthFlow;
  signal: AbortSignal;
  onProgress?: (stage: CombinedWatchProgress) => void;
}): Promise<CombinedWatchResult> {
  const { ch, deadlineMs, flow, signal, onProgress } = input;

  return await new Promise<CombinedWatchResult>((resolve, reject) => {
    let settled = false;
    let params: HandoffPublicParams | undefined;
    let payload: HandoffPayload | undefined;
    let session: SessionHandle | undefined;
    const timerHolder: { id?: ReturnType<typeof setTimeout> } = {};

    const finish = (result: CombinedWatchResult) => {
      if (settled) return;
      settled = true;
      if (timerHolder.id !== undefined) clearTimeout(timerHolder.id);
      resolve(result);
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timerHolder.id !== undefined) clearTimeout(timerHolder.id);
      if (session) {
        void signOutQuietly(session);
        session = undefined;
      }
      reject(error);
    };

    const maybeCombined = () => {
      if (
        params &&
        payload &&
        session &&
        classifyHandoffMode(params.mode) === HANDOFF_MODE_COMBINED
      ) {
        finish({ kind: "combined", params, payload, session, ch });
      }
    };

    const onAbort = () => {
      flow.canceled = true;
      if (session) {
        void signOutQuietly(session);
        session = undefined;
      }
      finish({ kind: "aborted" });
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    const remaining = Math.max(0, deadlineMs - Date.now());
    timerHolder.id = setTimeout(() => {
      if (session && !params) {
        finish({ kind: "locator_missing", session });
        return;
      }
      if (params && !session) {
        finish({ kind: "auth_missing", params });
        return;
      }
      finish({ kind: "timeout" });
    }, remaining);

    void waitForHandoffParams(ch, deadlineMs, signal)
      .then(async (next) => {
        if (settled || signal.aborted || flow.canceled) return;
        const mode = classifyHandoffMode(next.mode);
        if (!mode) return;
        onProgress?.("locator");
        rememberPendingHandoffLocator(ch, next);
        const decrypted = await decryptPendingHandoff(next, ch);
        if (mode === HANDOFF_MODE_LEGACY) {
          flow.canceled = true;
          finish({
            kind: "legacy",
            params: next,
            payload: decrypted,
            ch,
          });
          return;
        }
        params = next;
        payload = decrypted;
        maybeCombined();
      })
      .catch((error: unknown) => {
        if (settled || signal.aborted || flow.canceled) return;
        const name =
          typeof error === "object" && error !== null && "name" in error
            ? String((error as { name?: unknown }).name)
            : "";
        if (name === "RelayPollExhaustedError" || Date.now() >= deadlineMs) {
          if (session && !params) {
            finish({ kind: "locator_missing", session });
            return;
          }
          if (params && !session) {
            finish({ kind: "auth_missing", params });
            return;
          }
          finish({ kind: "timeout" });
          return;
        }
        if (name === "AbortError") {
          finish({ kind: "aborted" });
          return;
        }
        fail(error);
      });

    void PaykitLinkWeb.awaitAuthApproval(flow.handle)
      .then(async (next) => {
        if (flow.canceled) {
          await signOutQuietly(next);
          return;
        }
        if (settled) {
          await signOutQuietly(next);
          return;
        }
        onProgress?.("auth");
        session = next;
        flow.session = next;
        maybeCombined();
      })
      .catch((error: unknown) => {
        if (settled || flow.canceled || signal.aborted) return;
        fail(error);
      });
  });
}

export async function finishSingleApproval(input: {
  params: HandoffPublicParams;
  payload: HandoffPayload;
  session: SessionHandle;
  ch: string;
}): Promise<{ pubky: string; homeserver: string }> {
  const { ensureWriter } = await import("@/services/tabLock");
  await ensureWriter();
  const { params, payload, session, ch } = input;
  const handlePubky = session.pubky();
  if (params.pubky !== handlePubky || payload.pubky !== handlePubky) {
    await signOutQuietly(session);
    throw new BindingMismatchError("Handoff pubky does not match the approved session");
  }
  if (!(await pendingChannelMatches(ch))) {
    await signOutQuietly(session);
    throw new BindingMismatchError("Handoff channel does not match the pending ephemeral key");
  }
  const adopted = await adoptApprovedSession(session);
  await adoptHandoff(params, payload, ch);
  try {
    await provisionReceiver(adopted.handle, adopted.pubky);
  } catch (error) {
    throw new ProvisionReceiverFailedError(
      error instanceof Error ? error.message : "Failed to publish receiver",
    );
  }
  return { pubky: adopted.pubky, homeserver: params.homeserver };
}

export async function finishLegacyChainedGrant(input: {
  params: HandoffPublicParams;
  payload: HandoffPayload;
  session: SessionHandle;
  ch: string;
}): Promise<{ pubky: string; homeserver: string }> {
  const { ensureWriter } = await import("@/services/tabLock");
  await ensureWriter();
  const { params, payload, session, ch } = input;
  const handlePubky = session.pubky();
  if (params.pubky !== handlePubky || payload.pubky !== handlePubky) {
    await signOutQuietly(session);
    await wipeSessionMetadata();
    useAuthStore.getState().clearSession();
    throw new BindingMismatchError("Handoff pubky does not match the approved session");
  }
  if (!(await pendingChannelMatches(ch))) {
    await signOutQuietly(session);
    await wipeSessionMetadata();
    useAuthStore.getState().clearSession();
    throw new BindingMismatchError("Handoff channel does not match the pending ephemeral key");
  }
  const adopted = await adoptApprovedSession(session);
  await adoptHandoff(params, payload, ch);
  try {
    await provisionReceiver(adopted.handle, adopted.pubky);
  } catch (error) {
    throw new ProvisionReceiverFailedError(
      error instanceof Error ? error.message : "Failed to publish receiver",
    );
  }
  return { pubky: adopted.pubky, homeserver: params.homeserver };
}

export { HANDOFF_MODE_COMBINED, HANDOFF_MODE_LEGACY };
