import type { AuthFlowHandle } from "@/services/link/PaykitLinkWeb";
import type { PaykitConnectStart } from "@/services/RingConnect";
import type { CombinedWatchResult, TrackedAuthFlow } from "@/services/singleApproval";

export type LivePaykitConnect = {
  started: PaykitConnectStart;
  abort: AbortController;
  authFlow: TrackedAuthFlow;
};

export type LivePaykitConnectHandlers = {
  onResult?: (result: CombinedWatchResult) => Promise<void> | void;
  onProgress?: (stage: "locator" | "auth") => void;
  onError?: (error: unknown) => void;
};

let livePaykitConnect: LivePaykitConnect | null = null;
let startLock: Promise<void> | null = null;
let liveOnResult: LivePaykitConnectHandlers["onResult"];
let liveOnProgress: LivePaykitConnectHandlers["onProgress"];
let liveOnError: LivePaykitConnectHandlers["onError"];

export function getLivePaykitConnect(): LivePaykitConnect | null {
  return livePaykitConnect;
}

export function setLivePaykitConnect(next: LivePaykitConnect | null): void {
  livePaykitConnect = next;
}

export function getPaykitConnectStartLock(): Promise<void> | null {
  return startLock;
}

export function setPaykitConnectStartLock(lock: Promise<void> | null): void {
  startLock = lock;
}

export function getLivePaykitConnectHandlers(): LivePaykitConnectHandlers {
  return { onResult: liveOnResult, onProgress: liveOnProgress, onError: liveOnError };
}

export function setLivePaykitConnectHandlers(next: LivePaykitConnectHandlers): void {
  liveOnResult = next.onResult;
  liveOnProgress = next.onProgress;
  liveOnError = next.onError;
}

export function settleLivePaykitConnect(live: LivePaykitConnect): void {
  if (livePaykitConnect === live) {
    livePaykitConnect = null;
  }
}

export function resetPaykitConnectLive(): void {
  if (livePaykitConnect) {
    livePaykitConnect.authFlow.canceled = true;
    livePaykitConnect.abort.abort();
  }
  livePaykitConnect = null;
  startLock = null;
  liveOnResult = undefined;
  liveOnProgress = undefined;
  liveOnError = undefined;
}

export function resetPaykitConnectLiveForTests(): void {
  resetPaykitConnectLive();
}

export type { AuthFlowHandle };
