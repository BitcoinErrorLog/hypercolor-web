import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import { KeyStore } from "@/services/KeyStore";
import {
  HANDOFF_MODE_COMBINED,
  startPaykitConnect,
  type HandoffPayload,
  type HandoffPublicParams,
} from "./RingConnect";
import { PaykitLinkWeb, type SessionHandle } from "./link/PaykitLinkWeb";
import { adoptApprovedSession } from "./link/session";
import { provisionReceiver } from "./link/provisionReceiver";
import {
  finishLegacyChainedGrant,
  finishSingleApproval,
  watchCombinedGrant,
  type TrackedAuthFlow,
} from "./singleApproval";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const OTHER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";

vi.mock("./link/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./link/session")>();
  return {
    ...actual,
    adoptApprovedSession: vi.fn(),
  };
});

vi.mock("./link/provisionReceiver", () => ({
  provisionReceiver: vi.fn(),
}));

function exportWithCaps(...specs: string[]): string {
  return btoa(`meta${specs.join(",")}`);
}

function fakeSession(pubky: string, caps = RING_GRANT_CAPABILITIES.split(",")) {
  return {
    pubky: () => pubky,
    exportSession: () => exportWithCaps(...caps),
    free: vi.fn(),
  };
}

function payload(): HandoffPayload {
  return {
    version: 3,
    pubky: OWNER,
    noise_keypairs: [{ epoch: 0, public_key: "tpk", secret_key: "tsk" }],
    inbox_keypair: { public_key: "ipk", secret_key: "isk" },
    app_key: {
      ed25519_sk: "ask",
      ed25519_pk: "apk",
      cert_id: "cid",
      cert_body: "cbody",
      cert_sig: "csig",
    },
    expires_at: Math.floor(Date.now() / 1000) + 60,
  };
}

function params(mode = HANDOFF_MODE_COMBINED): HandoffPublicParams {
  return {
    pubky: OWNER,
    requestId: "ab".repeat(32),
    mode,
    homeserver: HOMESERVER,
  };
}

describe("startPaykitConnect embeds pubkyauth secret", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("embeds the 43-char secret and relay; ch is still derived from ephemeralPk", async () => {
    await KeyStore.initKeyStore();
    const secret = "A".repeat(43);
    const relay = "https://httprelay.pubky.app/link/";
    const pk = "aa".repeat(32);
    vi.spyOn(PaykitLinkWeb, "startAuthFlow").mockResolvedValue({
      authorizationUrl: () =>
        `pubkyauth:///?caps=${RING_GRANT_CAPABILITIES}&secret=${secret}&relay=${relay}`,
      awaitApproval: () => new Promise(() => undefined),
    } as never);
    vi.spyOn(PaykitLinkWeb, "x25519GenerateKeypair").mockResolvedValue({
      publicKey: pk,
      secretKey: "bb".repeat(32),
    });
    const started = await startPaykitConnect();
    const parsed = new URL(started.url.replace("pubkyring://", "https://ring/"));
    expect(parsed.searchParams.get("secret")).toBe(secret);
    expect(parsed.searchParams.get("secret")?.length).toBe(43);
    expect(parsed.searchParams.get("relay")).toBe(relay);
    expect(parsed.searchParams.get("ephemeralPk")).toBe(pk);
    expect(started.ch).toBeTruthy();
    expect(started.url).toContain("secret=");
  });
});

describe("finishSingleApproval order (never keys without cookie)", () => {
  beforeEach(async () => {
    await KeyStore.initKeyStore();
    await KeyStore.clear();
    vi.mocked(adoptApprovedSession).mockReset();
    vi.mocked(provisionReceiver).mockReset();
    vi.spyOn(KeyStore, "setPendingRingHandoff").mockResolvedValue(undefined);
    vi.spyOn(KeyStore, "getPendingRingHandoffPublicKey").mockResolvedValue("aa".repeat(32));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await KeyStore.clear();
  });

  it("calls adoptApprovedSession before adoptHandoff before provisionReceiver", async () => {
    const order: string[] = [];
    const session = fakeSession(OWNER);
    vi.mocked(adoptApprovedSession).mockImplementation(async (handle) => {
      order.push("adoptApprovedSession");
      expect(await KeyStore.getAppKeypair()).toBeNull();
      return { pubky: OWNER, handle };
    });
    vi.mocked(provisionReceiver).mockImplementation(async () => {
      order.push("provisionReceiver");
      return { pubky: OWNER, receiverPath: "hypercolor/wallet", noisePublicKey: "n" };
    });
    vi.spyOn(await import("./RingConnect"), "pendingChannelMatches").mockResolvedValue(true);
    const adoptHandoff = vi.spyOn(await import("./RingConnect"), "adoptHandoff").mockImplementation(async () => {
      order.push("adoptHandoff");
      return { pubky: OWNER, homeserver: HOMESERVER };
    });

    await finishSingleApproval({
      params: params(),
      payload: payload(),
      session: session as never,
      ch: "ch-1",
    });
    expect(order).toEqual(["adoptApprovedSession", "adoptHandoff", "provisionReceiver"]);
    expect(adoptHandoff).toHaveBeenCalled();
  });

  it("signs out and persists no keys on pubky mismatch", async () => {
    const signOut = vi.spyOn(PaykitLinkWeb, "signOutSession").mockResolvedValue(undefined);
    vi.spyOn(await import("./RingConnect"), "pendingChannelMatches").mockResolvedValue(true);
    const session = fakeSession(OTHER);
    await expect(
      finishSingleApproval({
        params: params(),
        payload: payload(),
        session: session as never,
        ch: "ch-1",
      }),
    ).rejects.toMatchObject({ name: "BindingMismatchError" });
    expect(signOut).toHaveBeenCalled();
    expect(adoptApprovedSession).not.toHaveBeenCalled();
    expect(await KeyStore.getAppKeypair()).toBeNull();
  });

  it("does not adopt when the token is missing /pub/paykit/:rw", async () => {
    vi.spyOn(await import("./RingConnect"), "pendingChannelMatches").mockResolvedValue(true);
    vi.mocked(adoptApprovedSession).mockRejectedValue(
      Object.assign(new Error("session grant does not cover"), {
        name: "SessionResumeScopeMissing",
      }),
    );
    const session = fakeSession(OWNER, ["/pub/hypercolor.app/v1/:rw"]);
    await expect(
      finishSingleApproval({
        params: params(),
        payload: payload(),
        session: session as never,
        ch: "ch-1",
      }),
    ).rejects.toMatchObject({ name: "SessionResumeScopeMissing" });
    expect(await KeyStore.getAppKeypair()).toBeNull();
  });
});

describe("watchCombinedGrant split delivery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("holds an auth-only handle until the deadline, then returns auth_timeout", async () => {
    const session = fakeSession(OWNER);
    const flow: TrackedAuthFlow = {
      handle: {
        authorizationUrl: () => "pubkyauth:///?caps=x&secret=y&relay=z",
        awaitApproval: async () => session,
      } as never,
      canceled: false,
    };
    const abort = new AbortController();
    vi.spyOn(await import("./relayChannel"), "pollLink").mockImplementation(
      () => new Promise(() => undefined),
    );
    const resultP = watchCombinedGrant({
      ch: "ch-hold",
      deadlineMs: Date.now() + 40,
      flow,
      signal: abort.signal,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(await KeyStore.getAppKeypair()).toBeNull();
    const result = await resultP;
    expect(result.kind).toBe("auth_timeout");
    if (result.kind === "auth_timeout") {
      expect(result.session).toBe(session);
    }
  });

  it("returns locator_timeout without persisting keys", async () => {
    vi.spyOn(await import("./RingConnect"), "waitForHandoffParams").mockResolvedValue(params());
    vi.spyOn(await import("./RingConnect"), "decryptPendingHandoff").mockResolvedValue(payload());
    vi.spyOn(PaykitLinkWeb, "awaitAuthApproval").mockImplementation(
      () => new Promise(() => undefined),
    );
    const flow: TrackedAuthFlow = {
      handle: { authorizationUrl: () => "" } as never,
      canceled: false,
    };
    const abort = new AbortController();
    await KeyStore.initKeyStore();
    const result = await watchCombinedGrant({
      ch: "ch-loc",
      deadlineMs: Date.now() + 30,
      flow,
      signal: abort.signal,
    });
    expect(result.kind).toBe("locator_timeout");
    expect(await KeyStore.getAppKeypair()).toBeNull();
  });

  it("signs out a late handle after the flow is canceled", async () => {
    const session = fakeSession(OWNER);
    let resolveAuth: ((value: SessionHandle) => void) | undefined;
    const signOut = vi.spyOn(PaykitLinkWeb, "signOutSession").mockResolvedValue(undefined);
    vi.spyOn(PaykitLinkWeb, "awaitAuthApproval").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );
    const flow: TrackedAuthFlow = {
      handle: { authorizationUrl: () => "" } as never,
      canceled: false,
    };
    const abort = new AbortController();
    vi.spyOn(await import("./relayChannel"), "pollLink").mockImplementation(
      () => new Promise(() => undefined),
    );
    const resultP = watchCombinedGrant({
      ch: "ch-cancel",
      deadlineMs: Date.now() + 5_000,
      flow,
      signal: abort.signal,
    });
    flow.canceled = true;
    abort.abort();
    resolveAuth?.(session as unknown as SessionHandle);
    await expect(resultP).resolves.toMatchObject({ kind: "aborted" });
    await vi.waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it("signs out a delivered session when the locator poll fails (F4)", async () => {
    const session = fakeSession(OWNER);
    const signOut = vi.spyOn(PaykitLinkWeb, "signOutSession").mockResolvedValue(undefined);
    vi.spyOn(PaykitLinkWeb, "awaitAuthApproval").mockResolvedValue(session as never);
    vi.spyOn(await import("./RingConnect"), "waitForHandoffParams").mockRejectedValue(
      Object.assign(new Error("relay exploded"), { name: "Error" }),
    );
    const flow: TrackedAuthFlow = {
      handle: { authorizationUrl: () => "" } as never,
      canceled: false,
    };
    const abort = new AbortController();
    await expect(
      watchCombinedGrant({
        ch: "ch-fail",
        deadlineMs: Date.now() + 5_000,
        flow,
        signal: abort.signal,
      }),
    ).rejects.toThrow("relay exploded");
    expect(signOut).toHaveBeenCalled();
  });
});

describe("finishLegacyChainedGrant (F7)", () => {
  beforeEach(async () => {
    await KeyStore.initKeyStore();
    await KeyStore.clear();
    vi.mocked(adoptApprovedSession).mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await KeyStore.clear();
  });

  it("checks pubky before adoptApprovedSession and signs out on mismatch", async () => {
    const signOut = vi.spyOn(PaykitLinkWeb, "signOutSession").mockResolvedValue(undefined);
    const session = fakeSession(OTHER);
    await expect(
      finishLegacyChainedGrant({
        params: params("secure_handoff"),
        payload: payload(),
        session: session as never,
        ch: "ch-legacy",
      }),
    ).rejects.toMatchObject({ name: "BindingMismatchError" });
    expect(signOut).toHaveBeenCalled();
    expect(adoptApprovedSession).not.toHaveBeenCalled();
  });
});

