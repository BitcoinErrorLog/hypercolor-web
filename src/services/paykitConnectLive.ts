import type { HandoffPublicParams, PaykitConnectStart } from "@/services/RingConnect";

export type LivePaykitConnect = {
  started: PaykitConnectStart;
  abort: AbortController;
};

export type LivePaykitConnectHandlers = {
  onParams?: (params: HandoffPublicParams, ch: string) => Promise<void> | void;
  onError?: (error: unknown) => void;
};

let livePaykitConnect: LivePaykitConnect | null = null;
let startLock: Promise<void> | null = null;
let liveOnParams: LivePaykitConnectHandlers["onParams"];
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
  return { onParams: liveOnParams, onError: liveOnError };
}

export function setLivePaykitConnectHandlers(next: LivePaykitConnectHandlers): void {
  liveOnParams = next.onParams;
  liveOnError = next.onError;
}

export function settleLivePaykitConnect(live: LivePaykitConnect): void {
  if (livePaykitConnect === live) {
    livePaykitConnect = null;
  }
}

export function resetPaykitConnectLive(): void {
  livePaykitConnect?.abort.abort();
  livePaykitConnect = null;
  startLock = null;
  liveOnParams = undefined;
  liveOnError = undefined;
}

export function resetPaykitConnectLiveForTests(): void {
  resetPaykitConnectLive();
}
