/**
 * Headless Pubky Ring counterparty for Playwright.
 * Test-only — never import from src/ runtime paths.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { bytesToHex, hexToBytes } from "../../src/lib/hex";
import { issueAppCert } from "./app-cert";
import {
  loadPubkySdk,
  type PubkyKeypair,
  type PubkyPublicKey,
  type PubkySdk,
  type PubkySession,
  type PubkySigner,
} from "./load-pubky";
import { asX25519HexPair, loadPaykitWasmNode } from "./paykit-wasm-node";
import {
  getHttpRelayBase,
  HANDOFF_PATH_PREFIX,
  HANDOFF_TTL_MS,
  relayChannelUrl,
  STAGING_HOMESERVER_Z32,
} from "./ring-wire";

const execFileAsync = promisify(execFile);
const GENERATE =
  process.env.PUBKY_STAGING_INVITE_SCRIPT ??
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";

export const STAGING_HOMESERVER = STAGING_HOMESERVER_Z32;

type PubkyFacade = InstanceType<PubkySdk["Pubky"]>;

export type RingIdentity = {
  pubky: string;
  homeserver: string;
};

export type RingSimulatorHandle = RingIdentity & {
  approvePaykitConnect(url: string): Promise<void>;
  approvePubkyauth(url: string): Promise<void>;
  approveRingUrl(url: string): Promise<"paykit-connect" | "pubkyauth">;
  dispose(): void;
};

function redactToken(error: unknown, token: string): Error {
  const message = error instanceof Error ? error.message : "ring-simulator failed";
  return new Error(message.split(token).join("[redacted]"));
}

async function mintSignupToken(): Promise<string> {
  let stdout: string;
  try {
    const result = await execFileAsync("bash", [GENERATE], { timeout: 20_000 });
    stdout = result.stdout;
  } catch {
    throw new Error("staging invite script failed");
  }
  const token = stdout.trim();
  if (!token) throw new Error("staging invite script returned an empty token");
  return token;
}

function parsePaykitConnect(url: string): {
  deviceId: string;
  callback: string;
  ephemeralPkHex: string;
  caps: string;
  channelId: string;
} {
  const parsed = new URL(url.replace(/^pubkyring:/i, "https:"));
  const deviceId = parsed.searchParams.get("deviceId") ?? "";
  const callback = parsed.searchParams.get("callback") ?? "";
  const ephemeralPkHex = (parsed.searchParams.get("ephemeralPk") ?? "").toLowerCase();
  const caps = parsed.searchParams.get("caps") ?? "";
  if (!deviceId) throw new Error("paykit-connect URL is missing deviceId");
  if (!callback.includes("://")) throw new Error("paykit-connect URL is missing callback");
  if (!/^[0-9a-f]{64}$/.test(ephemeralPkHex)) {
    throw new Error("paykit-connect URL is missing a 32-byte ephemeralPk");
  }
  const callbackUrl = new URL(callback);
  const channelId = callbackUrl.searchParams.get("ch") ?? "";
  if (!channelId) throw new Error("paykit-connect callback is missing ch");
  return { deviceId, callback, ephemeralPkHex, caps, channelId };
}

function parsePubkyauth(url: string): void {
  const parsed = new URL(url.replace(/^pubkyauth:/i, "https:"));
  const relay = parsed.searchParams.get("relay") ?? "";
  const secret = parsed.searchParams.get("secret") ?? "";
  if (!relay) throw new Error("pubkyauth URL is missing relay");
  if (!secret) throw new Error("pubkyauth URL is missing secret");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitUntilHomeserverPublished(
  client: PubkyFacade,
  userPk: PubkyPublicKey,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last = "unresolved";
  while (Date.now() < deadline) {
    try {
      const resolved = await withTimeout(
        client.getHomeserverOf(userPk),
        8_000,
        "getHomeserverOf",
      );
      const z32 = resolved?.z32() ?? "";
      if (z32 === STAGING_HOMESERVER) return;
      last = z32 || "unresolved";
    } catch (error) {
      last = error instanceof Error ? error.message : "resolve failed";
    }
    await sleep(1_500);
  }
  throw new Error(`PKDNS homeserver did not become resolvable (${last})`);
}

async function waitUntilPublicHandoff(
  client: PubkyFacade,
  pubky: string,
  path: string,
): Promise<void> {
  const address = `pubky${pubky}${path}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const json = await withTimeout(
        client.publicStorage.getJson(address),
        8_000,
        "publicStorage.getJson",
      );
      if (json && typeof json === "object" && json !== null && "sb2" in json) {
        return;
      }
    } catch {
      // Homeserver/pkarr can lag immediately after signup.
    }
    await sleep(1_000);
  }
  throw new Error("handoff is not publicly readable yet");
}

function classifyRingUrl(url: string): "paykit-connect" | "pubkyauth" {
  if (url.startsWith("pubkyring://paykit-connect")) return "paykit-connect";
  if (url.startsWith("pubkyauth:")) return "pubkyauth";
  throw new Error("unsupported Ring URL scheme");
}

function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function postRelayPublicParams(
  channelId: string,
  params: { pubky: string; requestId: string; homeserver: string },
): Promise<void> {
  const body = JSON.stringify({
    pubky: params.pubky,
    request_id: params.requestId,
    mode: "secure_handoff",
    homeserver: params.homeserver,
  });
  const response = await fetch(relayChannelUrl(channelId, getHttpRelayBase()), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!response.ok) {
    throw new Error(`httprelay POST ${response.status}`);
  }
}

export async function createStagingIdentity(): Promise<RingSimulatorHandle> {
  const sdk = loadPubkySdk();
  const wasm = await loadPaykitWasmNode();
  const keypair: PubkyKeypair = sdk.Keypair.random();
  const pubky = keypair.publicKey.z32();
  const homeserverPk = sdk.PublicKey.from(STAGING_HOMESERVER);
  const client = new sdk.Pubky();
  const signer: PubkySigner = client.signer(keypair);
  const token = await mintSignupToken();
  let session: PubkySession;
  try {
    try {
      await signer.signup(homeserverPk, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // Signup publishes PKDNS; a concurrent newer packet is not fatal if
      // the homeserver later resolves for this key.
      if (!/more recent SignedPacket/i.test(message)) {
        throw error;
      }
    }
    try {
      await signer.pkdns.publishHomeserverForce(homeserverPk);
    } catch {
      // Signup may already have published. Resolution is the acceptance gate.
    }
    await waitUntilHomeserverPublished(client, keypair.publicKey);
    session = await withTimeout(signer.signin("hypercolor-web"), 30_000, "signer.signin");
  } catch (error) {
    throw redactToken(error, token);
  }

  const secret = new Uint8Array(keypair.secret());
  const ownerPeerid = keypair.publicKey.toUint8Array();
  const wipe: Uint8Array[] = [secret];

  async function approvePaykitConnect(url: string): Promise<void> {
    const parsed = parsePaykitConnect(url);
    const requestId = randomHex(32);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = nowSeconds + Math.floor(HANDOFF_TTL_MS / 1000) - 30;
    const inbox = asX25519HexPair(wasm.x25519GenerateKeypair());
    const transport = asX25519HexPair(wasm.x25519GenerateKeypair());
    wasm.computeInboxKid(inbox.publicKey);
    const appPair = sdk.Keypair.random();
    const appSecret = new Uint8Array(appPair.secret());
    const appPub = appPair.publicKey.toUint8Array();
    const inboxSk = hexToBytes(inbox.secretKey);
    const transportSk = hexToBytes(transport.secretKey);
    wipe.push(appSecret, appPub, inboxSk, transportSk);
    const cert = issueAppCert({
      rootSecret: secret,
      issuerPeerid: ownerPeerid,
      appId: "hypercolor.app",
      appEd25519Pub: appPub,
      transportX25519Pub: hexToBytes(transport.publicKey),
      inboxX25519Pub: hexToBytes(inbox.publicKey),
    });
    const payload = {
      version: 3,
      pubky,
      capabilities: parsed.caps ? parsed.caps.split(",") : [],
      device_id: parsed.deviceId,
      noise_keypairs: [
        { epoch: 0, public_key: transport.publicKey, secret_key: transport.secretKey },
      ],
      noise_seed: randomHex(32),
      inbox_keypair: {
        public_key: inbox.publicKey,
        secret_key: inbox.secretKey,
      },
      app_key: {
        ed25519_sk: bytesToHex(appSecret),
        ed25519_pk: bytesToHex(appPub),
        cert_id: cert.certIdHex,
        cert_body: cert.certBodyHex,
        cert_sig: cert.sigHex,
      },
      created_at: nowSeconds,
      expires_at: expiresAt,
    };
    const storagePath = `${HANDOFF_PATH_PREFIX}${requestId}`;
    const envelope = wasm.sb2Encrypt(
      hexToBytes(parsed.ephemeralPkHex),
      new TextEncoder().encode(JSON.stringify(payload)),
      crypto.getRandomValues(new Uint8Array(32)),
      `handoff-${requestId}`,
      "handoff",
      pubky,
      pubky,
      pubky,
      storagePath,
      BigInt(nowSeconds),
      BigInt(expiresAt),
    );
    const signed = wasm.sb2Sign(envelope, secret, pubky, storagePath);
    await withTimeout(
      session.storage.putJson(storagePath, {
        sb2: Buffer.from(signed).toString("base64"),
      }),
      20_000,
      "session.storage.putJson",
    );
    await waitUntilPublicHandoff(client, pubky, storagePath);
    await withTimeout(
      postRelayPublicParams(parsed.channelId, {
        pubky,
        requestId,
        homeserver: STAGING_HOMESERVER,
      }),
      15_000,
      "httprelay POST",
    );
  }

  async function approvePubkyauth(url: string): Promise<void> {
    parsePubkyauth(url);
    await withTimeout(signer.approveAuthRequest(url), 30_000, "approveAuthRequest");
  }

  async function approveRingUrl(url: string): Promise<"paykit-connect" | "pubkyauth"> {
    const kind = classifyRingUrl(url);
    if (kind === "paykit-connect") await approvePaykitConnect(url);
    else await approvePubkyauth(url);
    return kind;
  }

  return {
    pubky,
    homeserver: STAGING_HOMESERVER,
    approvePaykitConnect,
    approvePubkyauth,
    approveRingUrl,
    dispose() {
      for (const buf of wipe) buf.fill(0);
    },
  };
}

export async function extractAuthUrl(page: Page, testIdPrefix: string): Promise<string> {
  const open = page.getByTestId(`${testIdPrefix}OpenRing`);
  await open.waitFor({ state: "visible", timeout: 30_000 });
  const href = await open.getAttribute("href");
  if (href && (href.startsWith("pubkyring:") || href.startsWith("pubkyauth:"))) {
    return href;
  }
  const visible = await page
    .locator("p.font-mono")
    .filter({ hasText: /pubky(ring|auth):/i })
    .first()
    .textContent();
  const trimmed = visible?.trim() ?? "";
  if (trimmed.startsWith("pubkyring:") || trimmed.startsWith("pubkyauth:")) {
    return trimmed;
  }
  throw new Error(`${testIdPrefix}OpenRing has no auth URL`);
}
