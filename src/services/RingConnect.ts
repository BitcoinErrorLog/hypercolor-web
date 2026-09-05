import { getRingCallbackUrl } from "@/lib/app-origin";
import { hexToBytes, isEvenHex, zeroizeBytes } from "@/lib/hex";
import { isValidPubky } from "@/utils/pubkyId";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import { KeyStore, type AppCert } from "@/services/KeyStore";
import {
  PaykitLinkWeb,
  toLinkNativeError,
  type AuthFlowHandle,
} from "@/services/link/PaykitLinkWeb";
import { pollLink, postLink, RelayPollExhaustedError } from "@/services/relayChannel";
import { deriveRingCallbackChannelId } from "@/services/ringChannelId";
import { useAuthStore } from "@/stores/authStore";

export const HANDOFF_TTL_MS = 5 * 60 * 1000;
export const HANDOFF_MODE_COMBINED = "secure_handoff+pubkyauth";
export const HANDOFF_MODE_LEGACY = "secure_handoff";
const PENDING_HANDOFF_LOCATOR_KEY = "hc.pendingHandoffLocator";
export const HANDOFF_PATH_PREFIX = "/pub/paykit.app/v0/handoff/";
export const HANDOFF_FETCH_TIMEOUT_MS = 15_000;
export const HANDOFF_FETCH_MAX_ATTEMPTS = 3;
export const HANDOFF_FETCH_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

type HandoffSleep = (ms: number) => Promise<void>;

function defaultHandoffSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let handoffSleep: HandoffSleep = defaultHandoffSleep;
let handoffFetchTimeoutMs = HANDOFF_FETCH_TIMEOUT_MS;

export function setHandoffFetchForTests(
  hooks: { sleep?: HandoffSleep; timeoutMs?: number } | null,
): void {
  handoffSleep = hooks?.sleep ?? defaultHandoffSleep;
  handoffFetchTimeoutMs = hooks?.timeoutMs ?? HANDOFF_FETCH_TIMEOUT_MS;
}

export function sanitizeHandoffError(err: unknown): string {
  return toLinkNativeError(err).message;
}

export type PaykitConnectStart = {
  url: string;
  ch: string;
  deviceId: string;
  deadlineMs: number;
  ephemeralPkHex: string;
  authFlow: AuthFlowHandle;
};

export type PubkyauthAuthorizationParts = {
  caps: string;
  secret: string;
  relay: string;
};

/**
 * Parse `pubkyauth:///?caps=&secret=&relay=` by hand. The URL has an empty
 * authority; `new URL` is not used (RN/web parsers disagree).
 */
export function parsePubkyauthAuthorizationUrl(raw: string): PubkyauthAuthorizationParts {
  if (typeof raw !== "string" || !raw.startsWith("pubkyauth:")) {
    throw new Error("pubkyauth URL is missing");
  }
  const qIndex = raw.indexOf("?");
  if (qIndex < 0) {
    throw new Error("pubkyauth URL is missing a query");
  }
  const query = raw.slice(qIndex + 1);
  const hash = query.indexOf("#");
  const q = hash >= 0 ? query.slice(0, hash) : query;
  const params = new Map<string, string>();
  for (const part of q.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key =
      eq < 0 ? decodeURIComponent(part) : decodeURIComponent(part.slice(0, eq));
    const value =
      eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
    params.set(key, value);
  }
  const caps = params.get("caps") ?? "";
  const secret = params.get("secret") ?? "";
  const relay = params.get("relay") ?? "";
  if (!caps || !secret || !relay) {
    throw new Error("pubkyauth URL is missing caps, secret, or relay");
  }
  return { caps, secret, relay };
}

export function classifyHandoffMode(
  mode: string,
): typeof HANDOFF_MODE_COMBINED | typeof HANDOFF_MODE_LEGACY | null {
  if (mode === HANDOFF_MODE_COMBINED) return HANDOFF_MODE_COMBINED;
  if (mode === HANDOFF_MODE_LEGACY) return HANDOFF_MODE_LEGACY;
  return null;
}

type PendingHandoffLocator = {
  ch: string;
  params: HandoffPublicParams;
};

function locatorStorage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function rememberPendingHandoffLocator(
  ch: string,
  params: HandoffPublicParams,
): void {
  const store = locatorStorage();
  if (!store) return;
  const record: PendingHandoffLocator = { ch, params };
  store.setItem(PENDING_HANDOFF_LOCATOR_KEY, JSON.stringify(record));
}

export function readPendingHandoffLocator(): PendingHandoffLocator | null {
  const store = locatorStorage();
  if (!store) return null;
  const raw = store.getItem(PENDING_HANDOFF_LOCATOR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingHandoffLocator;
    if (!parsed || typeof parsed.ch !== "string" || !parsed.params) return null;
    if (!classifyHandoffMode(parsed.params.mode)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingHandoffLocator(): void {
  locatorStorage()?.removeItem(PENDING_HANDOFF_LOCATOR_KEY);
}

export type HandoffPublicParams = {
  pubky: string;
  requestId: string;
  mode: string;
  homeserver: string;
};

export type HandoffPayload = {
  version: number;
  pubky: string;
  capabilities?: string[];
  device_id?: string;
  noise_keypairs: Array<{
    epoch: number;
    public_key: string;
    secret_key: string;
  }>;
  noise_seed?: string;
  inbox_keypair: {
    public_key: string;
    secret_key: string;
  };
  app_key?: {
    ed25519_sk: string;
    ed25519_pk: string;
    cert_id: string;
    cert_body: string;
    cert_sig: string;
  };
  created_at?: number;
  expires_at: number;
};

export function buildPaykitConnectUrl(input: {
  deviceId: string;
  ephemeralPkHex: string;
  callbackUrl: string;
  secret: string;
  relay: string;
}): string {
  const callback = encodeURIComponent(input.callbackUrl);
  return (
    `pubkyring://paykit-connect` +
    `?deviceId=${encodeURIComponent(input.deviceId)}` +
    `&callback=${callback}` +
    `&ephemeralPk=${encodeURIComponent(input.ephemeralPkHex)}` +
    `&caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}` +
    `&secret=${encodeURIComponent(input.secret)}` +
    `&relay=${encodeURIComponent(input.relay)}` +
    `&v=2`
  );
}

export function validateHandoffPublicParams(
  value: unknown,
): HandoffPublicParams | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const pubky = typeof record.pubky === "string" ? record.pubky : "";
  const requestId =
    typeof record.request_id === "string"
      ? record.request_id
      : typeof record.requestId === "string"
        ? record.requestId
        : "";
  const mode = typeof record.mode === "string" ? record.mode : "";
  const homeserver =
    typeof record.homeserver === "string" ? record.homeserver : "";
  if (!classifyHandoffMode(mode)) return null;
  if (!isValidPubky(pubky)) return null;
  if (!isEvenHex(requestId) || requestId.length < 8) return null;
  if (!isValidPubky(homeserver)) return null;
  return { pubky, requestId, mode, homeserver };
}

export function parseRelayHandoffBody(bytes: Uint8Array): HandoffPublicParams | null {
  try {
    const text = new TextDecoder().decode(bytes);
    return validateHandoffPublicParams(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export async function startPaykitConnect(): Promise<PaykitConnectStart> {
  await KeyStore.initKeyStore();
  const authFlow = await PaykitLinkWeb.startAuthFlow(RING_GRANT_CAPABILITIES);
  const parsed = parsePubkyauthAuthorizationUrl(authFlow.authorizationUrl());
  const pair = await PaykitLinkWeb.x25519GenerateKeypair();
  const pkBytes = hexToBytes(pair.publicKey);
  const ch = await deriveRingCallbackChannelId(pkBytes);
  const deadlineMs = Date.now() + HANDOFF_TTL_MS;
  await KeyStore.setPendingRingHandoff(pair.secretKey, pair.publicKey, ch, deadlineMs);
  const deviceId = `hypercolor-web-${Date.now().toString(16)}`;
  const callbackUrl = getRingCallbackUrl(ch);
  const url = buildPaykitConnectUrl({
    deviceId,
    ephemeralPkHex: pair.publicKey,
    callbackUrl,
    secret: parsed.secret,
    relay: parsed.relay,
  });
  return {
    url,
    ch,
    deviceId,
    deadlineMs,
    ephemeralPkHex: pair.publicKey,
    authFlow,
  };
}

/**
 * Long-poll the relay until a valid public-param set arrives or the
 * handoff TTL expires. Junk is rejected and polling resumes.
 */
export async function waitForHandoffParams(
  ch: string,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<HandoffPublicParams> {
  for (;;) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      throw new RelayPollExhaustedError("paykit-connect handoff TTL expired");
    }
    const body = await pollLink(ch, { deadlineMs, signal });
    const params = parseRelayHandoffBody(body);
    if (params) return params;
  }
}

export async function publishHandoffParamsToRelay(
  ch: string,
  params: HandoffPublicParams,
): Promise<void> {
  const body = JSON.stringify({
    pubky: params.pubky,
    request_id: params.requestId,
    mode: params.mode,
    homeserver: params.homeserver,
  });
  await postLink(ch, body);
}

export function certFromHandoffAppKey(
  appKey: NonNullable<HandoffPayload["app_key"]>,
): AppCert {
  return {
    certBodyHex: appKey.cert_body,
    sigHex: appKey.cert_sig,
    certIdHex: appKey.cert_id,
  };
}

function assertFiniteExpiresAt(expiresAt: unknown): number {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new Error("Handoff payload is missing a valid expires_at");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxExpires = nowSeconds + HANDOFF_TTL_MS / 1000;
  if (expiresAt <= nowSeconds) {
    throw new Error("Handoff payload has expired");
  }
  if (expiresAt > maxExpires) {
    throw new Error("Handoff payload expires_at is outside the allowed window");
  }
  return expiresAt;
}

function assertHandoffPubky(
  payloadPubky: unknown,
  params: HandoffPublicParams,
): string {
  if (payloadPubky !== undefined && payloadPubky !== params.pubky) {
    throw new Error("Handoff payload pubky does not match public params");
  }
  return params.pubky;
}

/**
 * Parse decrypted handoff JSON: drop `session_secret`, require a finite
 * `expires_at` inside `[now+ε, now+HANDOFF_TTL]`, and reject a payload
 * `pubky` that disagrees with the public params. Zeroizes `plaintext`.
 */
export function parseHandoffPlaintext(
  plaintext: Uint8Array,
  params: HandoffPublicParams,
): HandoffPayload {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  } finally {
    zeroizeBytes(plaintext);
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("Handoff payload is not an object");
  }
  const record = decoded as Record<string, unknown>;
  delete record.session_secret;

  const expiresAt = assertFiniteExpiresAt(record.expires_at);
  const pubky = assertHandoffPubky(record.pubky, params);

  if (!record.app_key) {
    throw new Error(
      "pubky-ring handoff does not include an app_key. Ensure pubky-ring supports AppKey delegation (v3 handoff).",
    );
  }

  return {
    ...(record as unknown as HandoffPayload),
    pubky,
    expires_at: expiresAt,
  };
}

export async function pendingChannelMatches(ch: string): Promise<boolean> {
  const pkHex = await KeyStore.getPendingRingHandoffPublicKey(ch);
  if (!pkHex) return false;
  try {
    const derived = await deriveRingCallbackChannelId(hexToBytes(pkHex));
    return derived === ch;
  } catch {
    return false;
  }
}

export function isRetryableHandoffFetchError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const name =
    "name" in err && typeof err.name === "string" ? err.name : "";
  const message =
    "message" in err && typeof err.message === "string" ? err.message : "";
  const combined = `${name} ${message}`;
  if (name === "TimeoutError" || /timeout/i.test(combined)) return true;
  if (/\b404\b|not[- ]found|pkarr|resol(ve|ution) miss|failed to resolve/i.test(combined)) {
    return true;
  }
  return false;
}

async function withHandoffFetchTimeout<T>(work: Promise<T>): Promise<T> {
  void work.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error("Handoff fetch timed out"), {
              name: "TimeoutError",
            }),
          );
        }, handoffFetchTimeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function fetchHandoffBytes(
  pubky: string,
  storagePath: string,
): Promise<Uint8Array> {
  let lastError: unknown = new Error("Handoff not found");
  for (let attempt = 0; attempt < HANDOFF_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = await withHandoffFetchTimeout(
        PaykitLinkWeb.publicGet(pubky, storagePath),
      );
      if (raw) return raw;
      lastError = new Error("Handoff not found");
    } catch (err) {
      lastError = err;
      if (!isRetryableHandoffFetchError(err)) {
        throw err;
      }
    }
    if (attempt < HANDOFF_FETCH_MAX_ATTEMPTS - 1) {
      const backoff = HANDOFF_FETCH_BACKOFF_MS[attempt] ?? HANDOFF_FETCH_BACKOFF_MS[2];
      await handoffSleep(backoff);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Handoff not found");
}

async function fetchAndDecryptHandoff(
  params: HandoffPublicParams,
  ephemeralSkHex: string,
): Promise<HandoffPayload> {
  const storagePath = `${HANDOFF_PATH_PREFIX}${params.requestId}`;
  const raw = await fetchHandoffBytes(params.pubky, storagePath);
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as { sb2?: unknown };
  if (typeof parsed.sb2 !== "string" || parsed.sb2.length === 0) {
    throw new Error('Handoff response is missing the "sb2" field.');
  }
  const envelope = Uint8Array.from(atob(parsed.sb2), (c) => c.charCodeAt(0));
  const valid = await PaykitLinkWeb.sb2VerifySignature(
    envelope,
    params.pubky,
    storagePath,
  );
  if (!valid) {
    throw new Error(
      "Handoff SB2 signature verification failed — possible tampering.",
    );
  }
  const sk = hexToBytes(ephemeralSkHex);
  let plaintext: Uint8Array;
  try {
    plaintext = await PaykitLinkWeb.sb2Decrypt(
      envelope,
      sk,
      params.pubky,
      storagePath,
    );
  } finally {
    zeroizeBytes(sk);
  }
  return parseHandoffPlaintext(plaintext, params);
}

/**
 * Fetch, verify, decrypt. Does not persist until {@link adoptHandoff}.
 */
export async function decryptPendingHandoff(
  params: HandoffPublicParams,
  ch: string,
): Promise<HandoffPayload> {
  const ephemeralSkHex = await KeyStore.getPendingRingHandoff(ch);
  if (!ephemeralSkHex) {
    throw new Error(
      "No pending delegation request. Call startPaykitConnect() before handling the callback.",
    );
  }
  return fetchAndDecryptHandoff(params, ephemeralSkHex);
}

/**
 * After a cookie exists, adopt a still-decryptable pending handoff for `pubky`
 * (reload between cookie and keys, or old-Ring chained grant).
 */
export async function tryAdoptPendingHandoffForSession(pubky: string): Promise<boolean> {
  const stored = readPendingHandoffLocator();
  if (!stored) return false;
  if (!(await pendingChannelMatches(stored.ch))) return false;
  if (stored.params.pubky !== pubky) return false;
  let payload: HandoffPayload;
  try {
    payload = await decryptPendingHandoff(stored.params, stored.ch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/expired|expires_at/i.test(message)) {
      clearPendingHandoffLocator();
      return false;
    }
    throw error;
  }
  if (payload.pubky !== pubky) {
    throw new Error("Handoff payload pubky does not match session");
  }
  await adoptHandoff(stored.params, payload, stored.ch);
  return true;
}

/**
 * Persist UKD/app keys. `session_secret` is discarded — the write credential
 * on web is the pubkyauth cookie, not this bearer.
 */
export async function adoptHandoff(
  params: HandoffPublicParams,
  payload: HandoffPayload,
  ch?: string,
): Promise<{ pubky: string; homeserver: string }> {
  const pubky = assertHandoffPubky(payload.pubky, params);
  const homeserver = params.homeserver;
  if (!payload.app_key) {
    throw new Error("Handoff is missing app_key");
  }
  await KeyStore.setPubky(pubky);
  await KeyStore.setHomeserver(homeserver);
  await KeyStore.setAppKeypair({
    secretKey: payload.app_key.ed25519_sk,
    publicKey: payload.app_key.ed25519_pk,
  });
  await KeyStore.setAppCert(certFromHandoffAppKey(payload.app_key));
  await KeyStore.setInboxKeypair({
    secretKey: payload.inbox_keypair.secret_key,
    publicKey: payload.inbox_keypair.public_key,
  });
  const transport = payload.noise_keypairs[0];
  if (transport) {
    await KeyStore.setTransportKeypair({
      secretKey: transport.secret_key,
      publicKey: transport.public_key,
    });
  }
  if (payload.noise_seed) {
    await KeyStore.setNoiseSeed(payload.noise_seed);
  }
  await KeyStore.clearPendingRingHandoff(ch);
  clearPendingHandoffLocator();
  useAuthStore.getState().setAuthenticated(pubky, homeserver);
  return { pubky, homeserver };
}

export async function completeHandoffAfterConfirmation(
  params: HandoffPublicParams,
  confirm: (pubky: string) => Promise<boolean>,
  ch: string,
): Promise<{ pubky: string; homeserver: string } | null> {
  const payload = await decryptPendingHandoff(params, ch);
  const pubky = assertHandoffPubky(payload.pubky, params);
  const accepted = await confirm(pubky);
  if (!accepted) return null;
  return adoptHandoff(params, payload, ch);
}
