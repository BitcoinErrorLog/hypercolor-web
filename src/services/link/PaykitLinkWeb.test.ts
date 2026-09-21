import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyStore } from "@/services/KeyStore";
import {
  PaykitLinkWeb,
  resetPaykitClientForTests,
  resetPaykitLinkHandlesForTests,
  setPaykitWasmForTests,
} from "./PaykitLinkWeb";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const RECEIVER_ALIAS = "hypercolor/wallet";
const SECRET = new Uint8Array([9, 8, 7, 6]);

function sessionHandle() {
  return {
    pubky: () => OWNER,
    putPublic: vi.fn(),
    deletePublic: vi.fn(),
    exportSession: () => "export",
    free: vi.fn(),
  };
}

function handshake(opts: {
  before: Uint8Array;
  after: Uint8Array;
  status: "pending" | "complete";
  link?: { snapshot: () => Uint8Array; close: () => Promise<void>; free: () => void };
}) {
  let current = new Uint8Array(opts.before);
  return {
    snapshot: () => new Uint8Array(current),
    advance: vi.fn(async () => {
      current = new Uint8Array(opts.after);
      return { status: opts.status, link: opts.link };
    }),
    free: vi.fn(),
    setMaxRecoveryAttempts: vi.fn(),
  };
}

describe("PaykitLinkWeb cookie rule", () => {
  it("putPublic forwards path and bytes only", async () => {
    const putPublic = vi.fn(async () => undefined);
    const session = { putPublic };
    await PaykitLinkWeb.putPublic(
      session as never,
      "/pub/hypercolor.app/v1/doc.json",
      new Uint8Array([1, 2, 3]),
    );
    expect(putPublic).toHaveBeenCalledTimes(1);
    expect(putPublic).toHaveBeenCalledWith(
      "/pub/hypercolor.app/v1/doc.json",
      new Uint8Array([1, 2, 3]),
    );
  });

  it("keeps production marker reads typed and separate from raw capability storage", async () => {
    const getReceiverMarker = vi.fn(async () => ({
      version: 1,
      kind: "paykit.receiver",
      receiver_path: "hypercolor/wallet",
      capabilities: {
        private_payments: true,
        payment_requests: false,
        receipts: false,
        outgoing_payments: false,
      },
      noise_public_key: "noise-pk",
    }));
    setPaykitWasmForTests(
      {
        getReceiverMarker,
        PubkyClient: class {},
      } as never,
      {} as never,
    );
    await expect(
      PaykitLinkWeb.getReceiverMarker(OWNER, "hypercolor/wallet"),
    ).resolves.toEqual({ noisePublicKey: "noise-pk" });
    expect(getReceiverMarker).toHaveBeenCalledWith(
      expect.anything(),
      OWNER,
      "hypercolor/wallet",
    );
    setPaykitWasmForTests(null, null);
  });
});

describe("PaykitLinkWeb Encrypted Links adapter", () => {
  const accept = vi.fn();
  const initiate = vi.fn();
  const restoreLink = vi.fn();
  const restoreHandshake = vi.fn();
  const clearOutbox = vi.fn();
  const noisePk = vi.fn(async () => "noise-pk");

  beforeAll(async () => {
    await KeyStore.initKeyStore();
  });

  beforeEach(async () => {
    await KeyStore.clear();
    await KeyStore.setPubky(OWNER);
    await KeyStore.setReceiverNoiseSecret(RECEIVER_ALIAS, SECRET);
    resetPaykitLinkHandlesForTests();
    resetPaykitClientForTests();
    accept.mockReset();
    initiate.mockReset();
    restoreLink.mockReset();
    restoreHandshake.mockReset();
    clearOutbox.mockReset();
    setPaykitWasmForTests(
      {
        acceptEncryptedLink: (...args: unknown[]) => accept(...args),
        initiateEncryptedLink: (...args: unknown[]) => initiate(...args),
        restoreEncryptedLink: (...args: unknown[]) => restoreLink(...args),
        restoreEncryptedLinkHandshake: (...args: unknown[]) => restoreHandshake(...args),
        clearEncryptedLinkOutbox: (...args: unknown[]) => clearOutbox(...args),
        noisePublicKeyFromSecret: () => "noise-pk",
        generateNoiseSecretKey: () => new Uint8Array([1, 2, 3]),
        PubkyClient: class {
          // test double
        },
      } as never,
      {} as never,
    );
    void noisePk;
  });

  afterEach(() => {
    resetPaykitLinkHandlesForTests();
    setPaykitWasmForTests(null, null);
    resetPaykitClientForTests();
  });

  it("wraps initiate snapshots; TS never parses the inner bytes", async () => {
    const raw = new Uint8Array([1, 2, 3, 4, 99]);
    initiate.mockReturnValue(
      handshake({ before: raw, after: raw, status: "pending" }),
    );
    const result = await PaykitLinkWeb.initiateLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
    );
    expect(result.linkId.length).toBeGreaterThan(0);
    expect(result.snapshot.startsWith("HC1.")).toBe(true);
    expect(() => JSON.parse(result.snapshot)).toThrow();
    const recovered = await KeyStore.unwrapLinkSnapshot(result.snapshot);
    expect(recovered).toEqual(raw);
  });

  it("probeInboundLink discards when snapshot bytes are unchanged", async () => {
    const same = new Uint8Array([10, 11, 12]);
    const issued: Uint8Array[] = [];
    const handle = {
      snapshot: () => {
        const copy = new Uint8Array(same);
        issued.push(copy);
        return copy;
      },
      advance: vi.fn(async () => ({ status: "pending" as const })),
      free: vi.fn(),
      setMaxRecoveryAttempts: vi.fn(),
    };
    accept.mockReturnValue(handle);
    const probed = await PaykitLinkWeb.probeInboundLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
    );
    expect(probed).toEqual({ result: "none" });
    expect(handle.free).toHaveBeenCalled();
    expect(issued.length).toBeGreaterThanOrEqual(2);
    expect(issued[1]).toEqual(new Uint8Array(3));
  });

  it("probeInboundLink keeps a pending handshake when snapshot bytes change", async () => {
    const before = new Uint8Array([1, 1, 1]);
    const after = new Uint8Array([2, 2, 2]);
    const handle = handshake({ before, after, status: "pending" });
    accept.mockReturnValue(handle);
    const probed = await PaykitLinkWeb.probeInboundLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
    );
    expect(probed.result).toBe("pending");
    if (probed.result === "pending") {
      expect(probed.snapshot.startsWith("HC1.")).toBe(true);
      expect(await KeyStore.unwrapLinkSnapshot(probed.snapshot)).toEqual(after);
    }
    expect(handle.free).not.toHaveBeenCalled();
  });

  it("probeInboundLink returns established when advance completes", async () => {
    const before = new Uint8Array([3, 3, 3]);
    const establishedBytes = new Uint8Array([4, 4, 4]);
    const link = {
      snapshot: () => new Uint8Array(establishedBytes),
      close: vi.fn(async () => undefined),
      free: vi.fn(),
      sendPrivateApplicationMessageJson: vi.fn(),
      receivePrivateApplicationMessages: vi.fn(),
    };
    accept.mockReturnValue(
      handshake({
        before,
        after: before,
        status: "complete",
        link,
      }),
    );
    const probed = await PaykitLinkWeb.probeInboundLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
    );
    expect(probed.result).toBe("established");
    if (probed.result === "established") {
      expect(await KeyStore.unwrapLinkSnapshot(probed.snapshot)).toEqual(establishedBytes);
    }
  });

  it("fresh pair: first responder probe is none, second persists msg2 after initiator write", async () => {
    const miss = new Uint8Array([10, 10, 10]);
    const afterMsg2 = new Uint8Array([11, 11, 11]);
    accept
      .mockReturnValueOnce({
        snapshot: () => new Uint8Array(miss),
        advance: vi.fn(async () => ({ status: "pending" as const })),
        free: vi.fn(),
        setMaxRecoveryAttempts: vi.fn(),
      })
      .mockReturnValueOnce(
        handshake({ before: miss, after: afterMsg2, status: "pending" }),
      );
    const first = await PaykitLinkWeb.probeInboundLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
    );
    expect(first).toEqual({ result: "none" });
    const second = await PaykitLinkWeb.probeInboundLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
    );
    expect(second.result).toBe("pending");
    if (second.result !== "pending") throw new Error("expected pending");
    expect(await KeyStore.unwrapLinkSnapshot(second.snapshot)).toEqual(afterMsg2);
  });

  it("logs a coarse advance-error and returns none instead of swallowing silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      accept.mockReturnValue({
        snapshot: () => new Uint8Array([1]),
        advance: vi.fn(async () => {
          throw new Error("failed to fetch");
        }),
        free: vi.fn(),
        setMaxRecoveryAttempts: vi.fn(),
      });
      await expect(
        PaykitLinkWeb.probeInboundLink(
          sessionHandle() as never,
          RECEIVER_ALIAS,
          PEER,
          "peer-noise",
          "hypercolor/wallet",
          "hypercolor/wallet",
        ),
      ).resolves.toEqual({ result: "none" });
      expect(warn).toHaveBeenCalledWith(
        "[PaykitLinkWeb] inbound-probe advance-error code=network",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("restoreLink unwraps the snapshot and passes Uint8Array to wasm", async () => {
    const inner = new Uint8Array([7, 8, 9]);
    const wrapped = await KeyStore.wrapLinkSnapshot(`${OWNER}:${PEER}`, inner);
    const established = {
      snapshot: () => new Uint8Array(inner),
      close: vi.fn(async () => undefined),
      free: vi.fn(),
    };
    let passed: Uint8Array | undefined;
    restoreLink.mockImplementation(async (...args: unknown[]) => {
      const snapshot = args[6];
      if (snapshot instanceof Uint8Array) passed = new Uint8Array(snapshot);
      return established;
    });
    const restored = await PaykitLinkWeb.restoreLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
      wrapped,
    );
    expect(restored.linkId.length).toBeGreaterThan(0);
    expect(passed).toBeInstanceOf(Uint8Array);
    expect(passed).toEqual(inner);
  });

  it("restoreHandshake zeroizes the receiver secret when unwrap throws", async () => {
    const localSecret = new Uint8Array(SECRET);
    const spy = vi
      .spyOn(KeyStore, "getReceiverNoiseSecret")
      .mockResolvedValueOnce(localSecret);
    try {
      await expect(
        PaykitLinkWeb.restoreHandshake(
          sessionHandle() as never,
          RECEIVER_ALIAS,
          PEER,
          "peer-noise",
          "hypercolor/wallet",
          "hypercolor/wallet",
          "not-a-valid-snapshot",
        ),
      ).rejects.toMatchObject({ code: "protocol" });
      expect(localSecret).toEqual(new Uint8Array(SECRET.length));
      expect(restoreHandshake).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("maps payment wasm writes and public reads through the adapter", async () => {
    const setEndpoint = vi.fn(async () => undefined);
    const removeEndpoint = vi.fn(async () => undefined);
    const getEndpoint = vi.fn(async () => "lno1dummyoffer");
    const getList = vi.fn(async () => ({ lno: "lno1dummyoffer" }));
    const listMethods = vi.fn(async () => ["lno"]);
    const listPaths = vi.fn(async () => ["hypercolor/wallet"]);
    const serializeList = vi.fn(() => '{"kind":"paykit.private_payment_list"}');
    const parseList = vi.fn(() => ({ lno: "lno1dummyoffer" }));
    setPaykitWasmForTests(
      {
        setPaymentEndpoint: setEndpoint,
        removePaymentEndpoint: removeEndpoint,
        getPaymentEndpoint: getEndpoint,
        getPaymentList: getList,
        listPaymentMethods: listMethods,
        listPaykitReceiverPaths: listPaths,
        serializePrivatePaymentListJson: serializeList,
        parsePrivatePaymentListJson: parseList,
        PubkyClient: class {
          // test double
        },
      } as never,
      { tag: "public-client" } as never,
    );

    const session = sessionHandle();
    await PaykitLinkWeb.setPaymentEndpoint(
      session as never,
      "hypercolor/wallet",
      "lno",
      "lno1dummyoffer",
    );
    expect(setEndpoint).toHaveBeenCalledWith(
      session,
      "hypercolor/wallet",
      "lno",
      "lno1dummyoffer",
    );

    await PaykitLinkWeb.removePaymentEndpoint(
      session as never,
      "hypercolor/wallet",
      "lno",
    );
    expect(removeEndpoint).toHaveBeenCalledWith(session, "hypercolor/wallet", "lno");

    await expect(
      PaykitLinkWeb.getPaymentEndpoint(PEER, "hypercolor/wallet", "lno"),
    ).resolves.toBe("lno1dummyoffer");
    expect(getEndpoint).toHaveBeenCalledWith(
      { tag: "public-client" },
      PEER,
      "hypercolor/wallet",
      "lno",
    );

    await expect(
      PaykitLinkWeb.getPaymentList(PEER, "hypercolor/wallet"),
    ).resolves.toEqual({ lno: "lno1dummyoffer" });
    await expect(
      PaykitLinkWeb.listPaymentMethods(PEER, "hypercolor/wallet"),
    ).resolves.toEqual(["lno"]);
    await expect(PaykitLinkWeb.listPaykitReceiverPaths(PEER)).resolves.toEqual([
      "hypercolor/wallet",
    ]);

    await expect(
      PaykitLinkWeb.serializePrivatePaymentListJson({ lno: "lno1dummyoffer" }),
    ).resolves.toBe('{"kind":"paykit.private_payment_list"}');
    await expect(
      PaykitLinkWeb.parsePrivatePaymentListJson('{"kind":"paykit.private_payment_list"}'),
    ).resolves.toEqual({ lno: "lno1dummyoffer" });
  });

  it("treats a missing public payment endpoint as undefined", async () => {
    setPaykitWasmForTests(
      {
        getPaymentEndpoint: vi.fn(async () => undefined),
        getPaymentList: vi.fn(async () => ({})),
        listPaymentMethods: vi.fn(async () => []),
        PubkyClient: class {
          // test double
        },
      } as never,
      {} as never,
    );
    await expect(
      PaykitLinkWeb.getPaymentEndpoint(PEER, "hypercolor/wallet", "lno"),
    ).resolves.toBeUndefined();
    await expect(
      PaykitLinkWeb.getPaymentList(PEER, "hypercolor/wallet"),
    ).resolves.toEqual({});
    await expect(
      PaykitLinkWeb.listPaymentMethods(PEER, "hypercolor/wallet"),
    ).resolves.toEqual([]);
  });

  it("maps payment wasm validation failures to LinkNativeError", async () => {
    setPaykitWasmForTests(
      {
        setPaymentEndpoint: vi.fn(async () => {
          throw new Error("validation failed: identifier is reserved");
        }),
        parsePrivatePaymentListJson: vi.fn(() => {
          throw new Error("validation failed: malformed private payment list");
        }),
        PubkyClient: class {
          // test double
        },
      } as never,
      {} as never,
    );
    await expect(
      PaykitLinkWeb.setPaymentEndpoint(
        sessionHandle() as never,
        "hypercolor/wallet",
        "private",
        "x",
      ),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      PaykitLinkWeb.parsePrivatePaymentListJson("{"),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("sendPrivatePaymentList uses the established handle and wraps the snapshot", async () => {
    const sendList = vi.fn(async () => undefined);
    const establishedBytes = new Uint8Array([5, 5, 5]);
    const link = {
      snapshot: () => new Uint8Array(establishedBytes),
      close: vi.fn(async () => undefined),
      free: vi.fn(),
      sendPrivateApplicationMessageJson: vi.fn(),
      receivePrivateApplicationMessages: vi.fn(),
      sendPrivatePaymentList: sendList,
    };
    accept.mockReturnValue(
      handshake({
        before: new Uint8Array([3, 3, 3]),
        after: new Uint8Array([3, 3, 3]),
        status: "complete",
        link,
      }),
    );
    const probed = await PaykitLinkWeb.probeInboundLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
    );
    expect(probed.result).toBe("established");
    if (probed.result !== "established") throw new Error("expected established");
    const sent = await PaykitLinkWeb.sendPrivatePaymentList(probed.linkId, {
      lno: "lno1dummyoffer",
    });
    expect(sendList).toHaveBeenCalledWith({ lno: "lno1dummyoffer" });
    expect(sent.snapshot.startsWith("HC1.")).toBe(true);
    expect(await KeyStore.unwrapLinkSnapshot(sent.snapshot)).toEqual(establishedBytes);
  });

  it("restoreLink zeroizes the receiver secret when unwrap throws", async () => {
    const localSecret = new Uint8Array(SECRET);
    const spy = vi
      .spyOn(KeyStore, "getReceiverNoiseSecret")
      .mockResolvedValueOnce(localSecret);
    try {
      await expect(
        PaykitLinkWeb.restoreLink(
          sessionHandle() as never,
          RECEIVER_ALIAS,
          PEER,
          "peer-noise",
          "hypercolor/wallet",
          "hypercolor/wallet",
          "not-a-valid-snapshot",
        ),
      ).rejects.toMatchObject({ code: "protocol" });
      expect(localSecret).toEqual(new Uint8Array(SECRET.length));
      expect(restoreLink).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("PaykitLinkWeb startAuthFlow client isolation", () => {
  afterEach(() => {
    resetPaykitLinkHandlesForTests();
    resetPaykitClientForTests();
    setPaykitWasmForTests(null, null);
  });

  it("constructs a new PubkyClient so Enable does not inherit a poisoned pkarr resolver", async () => {
    const startAuthFlow = vi.fn(() => ({
      authorizationUrl: () => "pubkyauth://x",
      awaitApproval: vi.fn(),
      free: vi.fn(),
    }));
    const free = vi.fn();
    let constructed = 0;
    class PubkyClient {
      startAuthFlow = startAuthFlow;
      free = free;
      constructor() {
        constructed += 1;
      }
    }
    setPaykitWasmForTests({ PubkyClient } as never);
    await PaykitLinkWeb.startAuthFlow("/pub/paykit/:rw");
    expect(constructed).toBe(1);
    await PaykitLinkWeb.startAuthFlow("/pub/paykit/:rw");
    expect(constructed).toBe(2);
    expect(free).not.toHaveBeenCalled();
    expect(startAuthFlow).toHaveBeenCalledTimes(2);
  });
});

describe("toLinkNativeError EncryptedLink concurrency", () => {
  it("maps in_flight and parked_result_conflict to unavailable", async () => {
    const { toLinkNativeError } = await import("./PaykitLinkWeb");
    expect(toLinkNativeError({ code: "in_flight", message: "send already in flight" })).toEqual({
      code: "unavailable",
      message: "unavailable",
    });
    expect(toLinkNativeError({ code: "parked_result_conflict", name: "ProtocolError" })).toEqual({
      code: "unavailable",
      message: "unavailable",
    });
    expect(
      toLinkNativeError(Object.assign(new Error("parked_result_conflict"), { name: "in_flight" })),
    ).toEqual({
      code: "unavailable",
      message: "unavailable",
    });
    expect(toLinkNativeError("protocol/in_flight")).toEqual({
      code: "unavailable",
      message: "unavailable",
    });
    expect(toLinkNativeError(new Error("ParkedResultConflict"))).toEqual({
      code: "unavailable",
      message: "unavailable",
    });
    const nested = new Error("wasm rejected");
    (nested as Error & { cause: string }).cause = "protocol/parked_result_conflict";
    expect(toLinkNativeError(nested)).toEqual({
      code: "unavailable",
      message: "unavailable",
    });
  });

  it("still coarsens unknown wasm text to protocol", async () => {
    const { toLinkNativeError } = await import("./PaykitLinkWeb");
    expect(toLinkNativeError(new Error("sqlite full at /tmp/x.db"))).toEqual({
      code: "protocol",
      message: "protocol error",
    });
  });
});

describe("PaykitLinkWeb EncryptedLink op serialization", () => {
  const restoreLink = vi.fn();

  beforeAll(async () => {
    await KeyStore.initKeyStore();
  });

  beforeEach(async () => {
    await KeyStore.clear();
    await KeyStore.setPubky(OWNER);
    await KeyStore.setReceiverNoiseSecret(RECEIVER_ALIAS, SECRET);
    resetPaykitLinkHandlesForTests();
    resetPaykitClientForTests();
    restoreLink.mockReset();
    setPaykitWasmForTests(
      {
        restoreEncryptedLink: (...args: unknown[]) => restoreLink(...args),
        PubkyClient: class {},
      } as never,
      {} as never,
    );
  });

  afterEach(() => {
    resetPaykitLinkHandlesForTests();
    setPaykitWasmForTests(null, null);
    resetPaykitClientForTests();
  });

  it("runs send only after an in-flight receive on the same link settles", async () => {
    let releaseReceive!: () => void;
    const receiveGate = new Promise<void>((resolve) => {
      releaseReceive = resolve;
    });
    const order: string[] = [];
    const established = {
      snapshot: () => new Uint8Array([1]),
      close: vi.fn(async () => undefined),
      free: vi.fn(),
      sendPrivateApplicationMessageJson: vi.fn(async () => {
        order.push("send");
      }),
      receivePrivateApplicationMessages: vi.fn(async () => {
        order.push("receive-start");
        await receiveGate;
        order.push("receive-end");
        return [];
      }),
    };
    restoreLink.mockResolvedValue(established);
    const inner = new Uint8Array([7, 8, 9]);
    const wrapped = await KeyStore.wrapLinkSnapshot(`${OWNER}:${PEER}`, inner);
    const restored = await PaykitLinkWeb.restoreLink(
      sessionHandle() as never,
      RECEIVER_ALIAS,
      PEER,
      "peer-noise",
      "hypercolor/wallet",
      "hypercolor/wallet",
      wrapped,
    );
    const receiving = PaykitLinkWeb.receivePrivateMessages(restored.linkId);
    await vi.waitFor(() => expect(order).toContain("receive-start"));
    const sending = PaykitLinkWeb.sendPrivateMessageJson(restored.linkId, '{"kind":"chat.delete.v0"}');
    await Promise.resolve();
    expect(order).toEqual(["receive-start"]);
    releaseReceive();
    await Promise.all([receiving, sending]);
    expect(order).toEqual(["receive-start", "receive-end", "send"]);
  });
});
