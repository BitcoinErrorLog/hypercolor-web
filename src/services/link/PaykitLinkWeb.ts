import { loadPaykitWasm } from "@/lib/paykit-wasm";
import { zeroizeBytes } from "@/lib/hex";
import { KeyStore } from "@/services/KeyStore";
import type {
  AuthFlowHandle,
  EncryptedLinkHandle,
  LinkHandshakeHandle,
  PubkyClient,
  SessionHandle,
} from "paykit-wasm";

export type { AuthFlowHandle, PubkyClient, SessionHandle };

export const LINK_NATIVE_ERROR_CODES = [
  "network",
  "auth",
  "protocol",
  "consumed",
  "validation",
  "unavailable",
] as const;

export type LinkNativeErrorCode = (typeof LINK_NATIVE_ERROR_CODES)[number];

export type LinkNativeError = {
  code: LinkNativeErrorCode;
  message: string;
};

export function isLinkNativeErrorCode(value: unknown): value is LinkNativeErrorCode {
  return (
    typeof value === "string" &&
    (LINK_NATIVE_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function isLinkNativeError(err: unknown): err is LinkNativeError {
  if (typeof err !== "object" || err === null) return false;
  const rec = err as { code?: unknown; message?: unknown };
  return isLinkNativeErrorCode(rec.code) && typeof rec.message === "string";
}

export function createLinkNativeError(
  code: LinkNativeErrorCode,
  message: string,
): LinkNativeError {
  return { code, message };
}

const COARSE_NATIVE_MESSAGES: Record<LinkNativeErrorCode, string> = {
  network: "network error",
  auth: "authentication failed",
  protocol: "protocol error",
  consumed: "resource consumed",
  validation: "validation failed",
  unavailable: "unavailable",
};

function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

function rawErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    const message = (err as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

export function toLinkNativeError(err: unknown): LinkNativeError {
  if (isLinkNativeError(err)) return err;
  const name = errorName(err);
  const message = rawErrorMessage(err);
  if (
    name === "SessionResumeUnauthorized" ||
    name === "SessionResumePubkyMismatch" ||
    name === "SessionResumeScopeMissing"
  ) {
    return { code: "auth", message: COARSE_NATIVE_MESSAGES.auth };
  }
  if (
    name === "NetworkError" ||
    /network|timeout|fetch|offline|econnreset|503|502|failed to fetch/i.test(
      `${name} ${message}`,
    )
  ) {
    return { code: "network", message: COARSE_NATIVE_MESSAGES.network };
  }
  if (/consumed|already (closed|used|freed)/i.test(message)) {
    return { code: "consumed", message: COARSE_NATIVE_MESSAGES.consumed };
  }
  if (/validat|invalid path|invalid pubky/i.test(message)) {
    return { code: "validation", message: COARSE_NATIVE_MESSAGES.validation };
  }
  if (/unavail/i.test(message) || name === "unavailable") {
    return { code: "unavailable", message: COARSE_NATIVE_MESSAGES.unavailable };
  }
  return { code: "protocol", message: COARSE_NATIVE_MESSAGES.protocol };
}

export interface ReceiverMarker {
  noisePublicKey: string;
  capabilitiesJson: string;
}

export interface LinkInitiateResult {
  linkId: string;
  snapshot: string;
}

export type LinkProbeResult =
  | { result: "none" }
  | { result: "pending"; linkId: string; snapshot: string }
  | { result: "established"; linkId: string; snapshot: string };

export interface LinkAdvanceResult {
  status: "pending" | "established";
  snapshot: string;
}

export interface LinkRestoreHandshakeResult {
  linkId: string;
  status: "pending" | "established";
}

export interface LinkRestoreResult {
  linkId: string;
}

export interface LinkSendResult {
  snapshot: string;
}

export interface LinkInboundMessage {
  version: number | null;
  kind: string | null;
  rawJson: string;
}

export interface LinkReceiveResult {
  messages: LinkInboundMessage[];
  snapshot: string;
}

export type PaymentEndpointMap = Record<string, string>;

type LiveWasmHandle =
  | { kind: "handshake"; handle: LinkHandshakeHandle; alias: string }
  | { kind: "established"; handle: EncryptedLinkHandle; alias: string };

const liveWasmHandles = new Map<string, LiveWasmHandle>();

type PaykitWasmSurface = Awaited<ReturnType<typeof loadPaykitWasm>>;

let testWasm: PaykitWasmSurface | null = null;
let testClient: PubkyClient | null = null;

export function setPaykitWasmForTests(
  wasm: PaykitWasmSurface | null,
  client?: PubkyClient | null,
): void {
  testWasm = wasm;
  testClient = client ?? null;
}

export function resetPaykitLinkHandlesForTests(): void {
  for (const entry of liveWasmHandles.values()) {
    try {
      entry.handle.free();
    } catch {
      // test teardown
    }
  }
  liveWasmHandles.clear();
}

async function wasmModule(): Promise<PaykitWasmSurface> {
  if (testWasm) return testWasm;
  return loadPaykitWasm();
}

export type X25519KeypairHex = {
  publicKey: string;
  secretKey: string;
};

let client: PubkyClient | null = null;

/**
 * Auth / storage adapter over vendored paykit-wasm.
 *
 * `SessionHandle.exportSession()` is secret-free SessionInfo metadata.
 * It must never be placed in a Cookie header — the homeserver cookie
 * value is `session_secret`, and JS cannot read that HttpOnly cookie.
 */
export async function getPaykitClient(): Promise<PubkyClient> {
  if (testClient) return testClient;
  const wasm = await wasmModule();
  client ??= new wasm.PubkyClient();
  return client;
}

/** Compile wasm and construct the client before cookie resume's budget starts. */
export async function warmPaykitClient(): Promise<void> {
  await getPaykitClient();
}

export function resetPaykitClientForTests(): void {
  client = null;
}

export const PaykitLinkWeb = {
  async startAuthFlow(capabilities: string): Promise<AuthFlowHandle> {
    const wasmClient = await getPaykitClient();
    return wasmClient.startAuthFlow(capabilities);
  },

  async awaitAuthApproval(flow: AuthFlowHandle): Promise<SessionHandle> {
    return (await flow.awaitApproval()) as SessionHandle;
  },

  /**
   * Dev/e2e only. Production sign-in is `startAuthFlow`.
   */
  async signinWithSecret(identitySecret: Uint8Array): Promise<SessionHandle> {
    const wasmClient = await getPaykitClient();
    return (await wasmClient.signinWithSecret(identitySecret)) as SessionHandle;
  },

  /**
   * Dev/e2e only. Production sign-up is Ring + pubkyauth.
   */
  async signupWithSecret(
    identitySecret: Uint8Array,
    homeserverZ32: string,
    signupToken?: string | null,
  ): Promise<SessionHandle> {
    const wasmClient = await getPaykitClient();
    return (await wasmClient.signupWithSecret(
      identitySecret,
      homeserverZ32,
      signupToken ?? undefined,
    )) as SessionHandle;
  },

  async restoreSession(exported: string): Promise<SessionHandle> {
    const wasmClient = await getPaykitClient();
    return (await wasmClient.restoreSession(exported)) as SessionHandle;
  },

  async resumeSessionFromCookie(pubky: string): Promise<SessionHandle> {
    const wasmClient = await getPaykitClient();
    return (await wasmClient.resumeSessionFromCookie(pubky)) as SessionHandle;
  },

  /**
   * Authenticated PUT. Path + body only — never a Cookie header, never
   * `exportSession()` as a bearer.
   */
  async putPublic(session: SessionHandle, path: string, body: Uint8Array): Promise<void> {
    await session.putPublic(path, body);
  },

  async deletePublic(session: SessionHandle, path: string): Promise<void> {
    await session.deletePublic(path);
  },

  async publicGet(
    ownerPubky: string,
    path: string,
  ): Promise<Uint8Array | undefined> {
    const wasm = await loadPaykitWasm();
    const wasmClient = await getPaykitClient();
    const result = (await wasm.publicGet(wasmClient, ownerPubky, path)) as
      | Uint8Array
      | undefined;
    return result;
  },

  async signOutSession(session: SessionHandle): Promise<void> {
    const wasm = await loadPaykitWasm();
    await wasm.signOutSession(session);
  },

  async generateNoiseSecretKey(): Promise<Uint8Array> {
    const wasm = await wasmModule();
    return wasm.generateNoiseSecretKey();
  },

  async noisePublicKeyFromSecret(secret: Uint8Array): Promise<string> {
    const wasm = await wasmModule();
    return wasm.noisePublicKeyFromSecret(secret);
  },

  async publishReceiverMarker(
    session: SessionHandle,
    receiverPath: string,
    noisePublicKey: string,
    privatePayments: boolean,
    paymentRequests: boolean,
    receipts: boolean,
    outgoingPayments: boolean,
  ): Promise<void> {
    const wasm = await loadPaykitWasm();
    await wasm.publishReceiverMarker(
      session,
      receiverPath,
      noisePublicKey,
      privatePayments,
      paymentRequests,
      receipts,
      outgoingPayments,
    );
  },

  async removeReceiverMarker(
    session: SessionHandle,
    receiverPath: string,
  ): Promise<void> {
    const wasm = await loadPaykitWasm();
    await wasm.removeReceiverMarker(session, receiverPath);
  },

  async x25519GenerateKeypair(): Promise<X25519KeypairHex> {
    const wasm = await loadPaykitWasm();
    const pair = wasm.x25519GenerateKeypair() as X25519KeypairHex;
    if (
      typeof pair?.publicKey !== "string" ||
      typeof pair?.secretKey !== "string"
    ) {
      throw new Error("x25519GenerateKeypair: unexpected wasm return shape");
    }
    return pair;
  },

  async sb2VerifySignature(
    envelope: Uint8Array,
    ownerPubky: string,
    canonicalPath: string,
  ): Promise<boolean> {
    const wasm = await loadPaykitWasm();
    return wasm.sb2VerifySignature(envelope, ownerPubky, canonicalPath);
  },

  async sb2Decrypt(
    envelope: Uint8Array,
    recipientSk: Uint8Array,
    ownerPubky: string,
    canonicalPath: string,
  ): Promise<Uint8Array> {
    const wasm = await loadPaykitWasm();
    return wasm.sb2Decrypt(envelope, recipientSk, ownerPubky, canonicalPath);
  },

  async setPaymentEndpoint(
    session: SessionHandle,
    receiverPath: string,
    identifier: string,
    payload: string,
  ): Promise<void> {
    return invoke(async () => {
      const wasm = await wasmModule();
      await wasm.setPaymentEndpoint(session, receiverPath, identifier, payload);
    });
  },

  async removePaymentEndpoint(
    session: SessionHandle,
    receiverPath: string,
    identifier: string,
  ): Promise<void> {
    return invoke(async () => {
      const wasm = await wasmModule();
      await wasm.removePaymentEndpoint(session, receiverPath, identifier);
    });
  },

  async getPaymentEndpoint(
    payeePubky: string,
    receiverPath: string,
    identifier: string,
  ): Promise<string | undefined> {
    return invoke(async () => {
      const wasm = await wasmModule();
      const wasmClient = await getPaykitClient();
      const payload = (await wasm.getPaymentEndpoint(
        wasmClient,
        payeePubky,
        receiverPath,
        identifier,
      )) as unknown;
      return typeof payload === "string" ? payload : undefined;
    });
  },

  async getPaymentList(
    payeePubky: string,
    receiverPath: string,
  ): Promise<PaymentEndpointMap> {
    return invoke(async () => {
      const wasm = await wasmModule();
      const wasmClient = await getPaykitClient();
      return asEndpointMap(
        await wasm.getPaymentList(wasmClient, payeePubky, receiverPath),
      );
    });
  },

  async listPaymentMethods(
    payeePubky: string,
    receiverPath: string,
  ): Promise<string[]> {
    return invoke(async () => {
      const wasm = await wasmModule();
      const wasmClient = await getPaykitClient();
      return asStringArray(
        await wasm.listPaymentMethods(wasmClient, payeePubky, receiverPath),
      );
    });
  },

  async listPaykitReceiverPaths(ownerPubky: string): Promise<string[]> {
    return invoke(async () => {
      const wasm = await wasmModule();
      const wasmClient = await getPaykitClient();
      return asStringArray(await wasm.listPaykitReceiverPaths(wasmClient, ownerPubky));
    });
  },

  async serializePrivatePaymentListJson(
    endpoints: PaymentEndpointMap,
  ): Promise<string> {
    return invoke(async () => {
      const wasm = await wasmModule();
      const json = wasm.serializePrivatePaymentListJson(endpoints);
      if (typeof json !== "string") {
        throw createLinkNativeError("protocol", "serializePrivatePaymentListJson");
      }
      return json;
    });
  },

  async parsePrivatePaymentListJson(rawJson: string): Promise<PaymentEndpointMap> {
    return invoke(async () => {
      const wasm = await wasmModule();
      return asEndpointMap(wasm.parsePrivatePaymentListJson(rawJson));
    });
  },

  isAvailable(): boolean {
    return true;
  },

  async getReceiverPublicKey(receiverAlias: string): Promise<string> {
    return invoke(async () => {
      const secret = await requireReceiverSecret(receiverAlias);
      try {
        const wasm = await wasmModule();
        return wasm.noisePublicKeyFromSecret(secret);
      } finally {
        zeroizeBytes(secret);
      }
    });
  },

  async generateReceiverKey(): Promise<{
    receiverAlias: string;
    noisePublicKey: string;
  }> {
    return invoke(async () => {
      const alias = crypto.randomUUID();
      const secret = await PaykitLinkWeb.generateNoiseSecretKey();
      try {
        await KeyStore.setReceiverNoiseSecret(alias, secret);
        const noisePublicKey = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
        return { receiverAlias: alias, noisePublicKey };
      } finally {
        zeroizeBytes(secret);
      }
    });
  },

  async getReceiverMarker(
    peerPubky: string,
    receiverPath: string,
  ): Promise<ReceiverMarker | null> {
    return invoke(async () => {
      const wasm = await wasmModule();
      const wasmClient = await getPaykitClient();
      const marker = (await wasm.getReceiverMarker(
        wasmClient,
        peerPubky,
        receiverPath,
      )) as
        | {
            noisePublicKey?: string;
            capabilities?: unknown;
          }
        | undefined
        | null;
      if (!marker || typeof marker.noisePublicKey !== "string") return null;
      return {
        noisePublicKey: marker.noisePublicKey,
        capabilitiesJson: JSON.stringify(marker.capabilities ?? {}),
      };
    });
  },

  async initiateLink(
    session: SessionHandle,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<LinkInitiateResult> {
    return invoke(async () => {
      const secret = await requireReceiverSecret(receiverAlias);
      try {
        const wasm = await wasmModule();
        const wasmClient = await getPaykitClient();
        const handle = wasm.initiateEncryptedLink(
          session,
          secret,
          peerPubky,
          peerNoisePublicKey,
          localReceiverPath,
          remoteReceiverPath,
          wasmClient,
        );
        const linkId = crypto.randomUUID();
        const alias = snapshotAlias(session.pubky(), peerPubky);
        const snapshot = await persistHandleSnapshot(handle.snapshot(), alias);
        liveWasmHandles.set(linkId, { kind: "handshake", handle, alias });
        return { linkId, snapshot };
      } finally {
        zeroizeBytes(secret);
      }
    });
  },

  /**
   * Emulates native `probeInboundLink` the way mp-dm does: accept + one
   * advance. Identical snapshot bytes mean nothing inbound — discard.
   */
  async probeInboundLink(
    session: SessionHandle,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<LinkProbeResult> {
    return invoke(async () => {
      const secret = await requireReceiverSecret(receiverAlias);
      let handle: LinkHandshakeHandle | null = null;
      try {
        const wasm = await wasmModule();
        const wasmClient = await getPaykitClient();
        handle = wasm.acceptEncryptedLink(
          session,
          secret,
          peerPubky,
          peerNoisePublicKey,
          localReceiverPath,
          remoteReceiverPath,
          wasmClient,
        );
        const before = handle.snapshot();
        try {
          let result: { status?: string; link?: EncryptedLinkHandle };
          try {
            result = (await handle.advance()) as {
              status?: string;
              link?: EncryptedLinkHandle;
            };
          } catch {
            freeQuietly(handle);
            return { result: "none" };
          }
          if (isAdvanceComplete(result) && result.link) {
            const alias = snapshotAlias(session.pubky(), peerPubky);
            const snapshot = await persistHandleSnapshot(result.link.snapshot(), alias);
            const linkId = crypto.randomUUID();
            liveWasmHandles.set(linkId, {
              kind: "established",
              handle: result.link,
              alias,
            });
            freeQuietly(handle);
            return { result: "established", linkId, snapshot };
          }
          const after = handle.snapshot();
          if (bytesEqual(before, after)) {
            zeroizeBytes(after);
            freeQuietly(handle);
            return { result: "none" };
          }
          const alias = snapshotAlias(session.pubky(), peerPubky);
          const snapshot = await persistHandleSnapshot(after, alias);
          const linkId = crypto.randomUUID();
          liveWasmHandles.set(linkId, { kind: "handshake", handle, alias });
          return { result: "pending", linkId, snapshot };
        } finally {
          zeroizeBytes(before);
        }
      } finally {
        zeroizeBytes(secret);
      }
    });
  },

  async advanceHandshake(linkId: string): Promise<LinkAdvanceResult> {
    return invoke(async () => {
      const entry = liveWasmHandles.get(linkId);
      if (!entry || entry.kind !== "handshake") {
        throw createLinkNativeError("protocol", "handshake handle missing");
      }
      const result = (await entry.handle.advance()) as {
        status?: string;
        link?: EncryptedLinkHandle;
      };
      if (isAdvanceComplete(result) && result.link) {
        const snapshot = await persistHandleSnapshot(
          result.link.snapshot(),
          entry.alias,
        );
        freeQuietly(entry.handle);
        liveWasmHandles.set(linkId, {
          kind: "established",
          handle: result.link,
          alias: entry.alias,
        });
        return { status: "established", snapshot };
      }
      const snapshot = await persistHandleSnapshot(
        entry.handle.snapshot(),
        entry.alias,
      );
      return { status: "pending", snapshot };
    });
  },

  async restoreHandshake(
    session: SessionHandle,
    receiverAlias: string,
    peerPubky: string,
    _peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
    snapshot: string,
  ): Promise<LinkRestoreHandshakeResult> {
    return invoke(async () => {
      const secret = await requireReceiverSecret(receiverAlias);
      try {
        const bytes = await KeyStore.unwrapLinkSnapshot(snapshot);
        const forWasm = new Uint8Array(bytes);
        zeroizeBytes(bytes);
        try {
          const wasm = await wasmModule();
          const wasmClient = await getPaykitClient();
          const handle = (await wasm.restoreEncryptedLinkHandshake(
            session,
            secret,
            peerPubky,
            localReceiverPath,
            remoteReceiverPath,
            wasmClient,
            forWasm,
          )) as LinkHandshakeHandle;
          const linkId = crypto.randomUUID();
          const alias = snapshotAlias(session.pubky(), peerPubky);
          liveWasmHandles.set(linkId, { kind: "handshake", handle, alias });
          return { linkId, status: "pending" };
        } finally {
          zeroizeBytes(forWasm);
        }
      } finally {
        zeroizeBytes(secret);
      }
    });
  },

  async restoreLink(
    session: SessionHandle,
    receiverAlias: string,
    peerPubky: string,
    _peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
    snapshot: string,
  ): Promise<LinkRestoreResult> {
    return invoke(async () => {
      const secret = await requireReceiverSecret(receiverAlias);
      try {
        const bytes = await KeyStore.unwrapLinkSnapshot(snapshot);
        const forWasm = new Uint8Array(bytes);
        zeroizeBytes(bytes);
        try {
          const wasm = await wasmModule();
          const wasmClient = await getPaykitClient();
          const handle = (await wasm.restoreEncryptedLink(
            session,
            secret,
            peerPubky,
            localReceiverPath,
            remoteReceiverPath,
            wasmClient,
            forWasm,
          )) as EncryptedLinkHandle;
          const linkId = crypto.randomUUID();
          const alias = snapshotAlias(session.pubky(), peerPubky);
          liveWasmHandles.set(linkId, { kind: "established", handle, alias });
          return { linkId };
        } finally {
          zeroizeBytes(forWasm);
        }
      } finally {
        zeroizeBytes(secret);
      }
    });
  },

  async sendPrivateMessageJson(
    linkId: string,
    rawJson: string,
  ): Promise<LinkSendResult> {
    return invoke(async () => {
      const entry = requireEstablished(linkId);
      await entry.handle.sendPrivateApplicationMessageJson(rawJson);
      const snapshot = await persistHandleSnapshot(
        entry.handle.snapshot(),
        entry.alias,
      );
      return { snapshot };
    });
  },

  async sendPrivatePaymentList(
    linkId: string,
    endpoints: PaymentEndpointMap,
  ): Promise<LinkSendResult> {
    return invoke(async () => {
      const entry = requireEstablished(linkId);
      await entry.handle.sendPrivatePaymentList(endpoints);
      const snapshot = await persistHandleSnapshot(
        entry.handle.snapshot(),
        entry.alias,
      );
      return { snapshot };
    });
  },

  async receivePrivateMessages(linkId: string): Promise<LinkReceiveResult> {
    return invoke(async () => {
      const entry = requireEstablished(linkId);
      const raw = (await entry.handle.receivePrivateApplicationMessages()) as
        | unknown[]
        | undefined;
      const messages = parseInboundMessages(raw);
      const snapshot = await persistHandleSnapshot(
        entry.handle.snapshot(),
        entry.alias,
      );
      return { messages, snapshot };
    });
  },

  async clearLinkOutbox(
    session: SessionHandle,
    receiverAlias: string,
    peerPubky: string,
    peerNoisePublicKey: string,
    localReceiverPath: string,
    remoteReceiverPath: string,
  ): Promise<number> {
    return invoke(async () => {
      const secret = await requireReceiverSecret(receiverAlias);
      try {
        const wasm = await wasmModule();
        const deleted = (await wasm.clearEncryptedLinkOutbox(
          session,
          secret,
          peerPubky,
          peerNoisePublicKey,
          localReceiverPath,
          remoteReceiverPath,
        )) as number;
        return typeof deleted === "number" ? deleted : 0;
      } finally {
        zeroizeBytes(secret);
      }
    });
  },

  async closeLink(linkId: string): Promise<void> {
    return invoke(async () => {
      const entry = liveWasmHandles.get(linkId);
      if (!entry) return;
      liveWasmHandles.delete(linkId);
      if (entry.kind === "established") {
        try {
          await entry.handle.close();
        } catch {
          // already closed
        }
      }
      freeQuietly(entry.handle);
    });
  },

  async clearAllNativeSecrets(): Promise<void> {
    await KeyStore.clear();
  },
};

async function invoke<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isLinkNativeError(err)) throw err;
    throw toLinkNativeError(err);
  }
}

async function requireReceiverSecret(receiverAlias: string): Promise<Uint8Array> {
  const secret = await KeyStore.getReceiverNoiseSecret(receiverAlias);
  if (!secret) {
    throw createLinkNativeError("validation", "receiver secret not found");
  }
  return secret;
}

async function persistHandleSnapshot(
  bytes: Uint8Array,
  alias: string,
): Promise<string> {
  try {
    return await KeyStore.wrapLinkSnapshot(alias, bytes);
  } finally {
    zeroizeBytes(bytes);
  }
}

function snapshotAlias(ownerPubky: string, peerPubky: string): string {
  return `${ownerPubky}:${peerPubky}`;
}

function requireEstablished(
  linkId: string,
): Extract<LiveWasmHandle, { kind: "established" }> {
  const entry = liveWasmHandles.get(linkId);
  if (!entry || entry.kind !== "established") {
    throw createLinkNativeError("network", "established link handle missing");
  }
  return entry;
}

function isAdvanceComplete(result: { status?: string; link?: EncryptedLinkHandle }): boolean {
  return result.status === "complete" || result.status === "established";
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function freeQuietly(handle: { free: () => void }): void {
  try {
    handle.free();
  } catch {
    // already freed
  }
}

function asEndpointMap(value: unknown): PaymentEndpointMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const out: PaymentEndpointMap = {};
  for (const [identifier, payload] of Object.entries(value)) {
    if (typeof payload === "string") {
      out[identifier] = payload;
    }
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseInboundMessages(raw: unknown[] | undefined): LinkInboundMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: LinkInboundMessage[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as { version?: unknown; kind?: unknown; rawJson?: unknown };
    if (typeof rec.rawJson !== "string") continue;
    out.push({
      version: typeof rec.version === "number" ? rec.version : null,
      kind: typeof rec.kind === "string" ? rec.kind : null,
      rawJson: rec.rawJson,
    });
  }
  return out;
}
