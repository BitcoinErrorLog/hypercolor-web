import { getHttpRelayBase } from "@/lib/http-relay";

export const RELAY_CHANNEL_PREFIX = "hc-";
export const RELAY_MAX_CONSECUTIVE_FAILURES = 3;

export type RelayFetch = typeof fetch;

let relayFetch: RelayFetch = (...args) => globalThis.fetch(...args);

export function setRelayFetchForTests(fn: RelayFetch | null): void {
  relayFetch = fn ?? ((...args) => globalThis.fetch(...args));
}

export function relayChannelId(ch: string): string {
  if (!ch) {
    throw new Error("relayChannelId: channel digest is empty");
  }
  return ch.startsWith(RELAY_CHANNEL_PREFIX) ? ch : `${RELAY_CHANNEL_PREFIX}${ch}`;
}

export function relayChannelUrl(ch: string, base = getHttpRelayBase()): string {
  const normalized = base.replace(/\/+$/, "");
  return `${normalized}/${relayChannelId(ch)}`;
}

export class RelayPollExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayPollExhaustedError";
  }
}

export type PollLinkOptions = {
  deadlineMs: number;
  signal?: AbortSignal;
};

/**
 * httprelay `link` GET: long-poll with bounded consecutive failures and
 * resumable timeout slices (`HttpRelayLinkChannel::poll`).
 */
export async function pollLink(
  ch: string,
  options: PollLinkOptions,
): Promise<Uint8Array> {
  const url = relayChannelUrl(ch);
  let consecutiveFailures = 0;
  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const remaining = options.deadlineMs - Date.now();
    if (remaining <= 0) {
      throw new RelayPollExhaustedError("httprelay poll deadline reached");
    }
    const timeout = AbortSignal.timeout(remaining);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      const response = await relayFetch(url, { method: "GET", signal });
      if (!response.ok) {
        throw new Error(`httprelay GET ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      if (isAbortTimeout(error)) {
        consecutiveFailures = 0;
        continue;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= RELAY_MAX_CONSECUTIVE_FAILURES) {
        throw error instanceof Error
          ? error
          : new Error("httprelay poll failed");
      }
    }
  }
}

export async function postLink(ch: string, body: Uint8Array | string): Promise<void> {
  const url = relayChannelUrl(ch);
  const payload: BodyInit =
    typeof body === "string" ? body : new Uint8Array(body);
  const response = await relayFetch(url, {
    method: "POST",
    body: payload,
    headers:
      typeof body === "string"
        ? { "content-type": "application/json" }
        : undefined,
  });
  if (!response.ok) {
    throw new Error(`httprelay POST ${response.status}`);
  }
}

function isAbortTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === "TimeoutError") return true;
  if (name === "AbortError") {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && /timeout/i.test(message);
  }
  return false;
}
