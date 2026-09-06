import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "../../db";
import { runMigrations } from "../../db/migrations";
import { openMemoryDb } from "../../db/__tests__/betterSqliteAdapter";
import { PRIVATE_GROUP_MEMBER_CAP } from "../../flags/config";
import {
  GROUP_MESSAGE_KIND,
  buildGroupDeleteEnvelope,
  buildGroupEditEnvelope,
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildGroupReactionEnvelope,
} from "../../types/group";
import { LINK_RECEIVER_PATH } from "../../types/link";
import { KeyStore } from "../KeyStore";
import { StorageService } from "../StorageService";
import { LinkService } from "../link/LinkService";
import { LocalChatState } from "../localChatState";
import { applyGroupInbound } from "./applyGroupInbound";
import { GroupService } from "./GroupService";

vi.mock("../KeyStore", () => ({
  KeyStore: {
    getPubky: vi.fn(),
  },
}));

vi.mock("../link/LinkService", () => ({
  LinkService: {
    sendPersistedLinkJson: vi.fn(),
  },
}));

const mockedKeyStore = vi.mocked(KeyStore);
const mockedLink = vi.mocked(LinkService);

const OWNER = "a".repeat(52);
const PEER_A = "b".repeat(52);
const PEER_B = "c".repeat(52);
const PEER_C = "d".repeat(52);
const STRANGER = "e".repeat(52);
const EVENT = "00000000-0000-4000-8000-000000000001";
const EVENT2 = "00000000-0000-4000-8000-000000000002";
const EVENT3 = "00000000-0000-4000-8000-000000000003";
const NOW = 1_700_000_000_000;

describe("GroupService", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    mockedKeyStore.getPubky.mockResolvedValue(OWNER);
    mockedLink.sendPersistedLinkJson.mockImplementation(async (input) => {
      await StorageService.removeFromQueue(input.queueId);
      return "sent";
    });
    await seedEstablishedLink(PEER_A);
    await seedEstablishedLink(PEER_B);
  });

  afterEach(() => {
    setDbForTests(null);
    vi.restoreAllMocks();
  });

  async function createPrivateGroup(): Promise<string> {
    const channel = await GroupService.createChannel("Crew", [PEER_A, PEER_B]);
    expect(channel.channelId.startsWith(`${OWNER}:`)).toBe(true);
    expect(channel.isPublic).toBe(false);
    return channel.channelId;
  }

  it("creates a founder-bound private channel and fans membership to linked members", async () => {
    const channelId = await createPrivateGroup();
    const peers = mockedLink.sendPersistedLinkJson.mock.calls.map(
      (call) => call[0]!.peerPubky,
    );
    expect(peers).toContain(PEER_A);
    expect(peers).toContain(PEER_B);
    expect(peers).not.toContain(OWNER);
    const kinds = mockedLink.sendPersistedLinkJson.mock.calls.map((call) => call[0]!.kind);
    expect(kinds.every((kind) => kind === "chat.group.membership.v0")).toBe(true);
    const channel = await StorageService.getGroupChannel(OWNER, channelId);
    expect(channel?.createdBy).toBe(OWNER);
    expect(await StorageService.getGroupMember(OWNER, channelId, OWNER)).toEqual(
      expect.objectContaining({ role: "admin", status: "active" }),
    );
  });

  it("refuses create and add when the member has no established Encrypted Link", async () => {
    await expect(GroupService.createChannel("No link", [PEER_C])).rejects.toThrow(
      /established Encrypted Link/,
    );
    const channelId = await createPrivateGroup();
    await expect(GroupService.addMember(channelId, PEER_C)).rejects.toThrow(
      /established Encrypted Link/,
    );
  });

  it("fans out a group message to every linked active member and skips removed members", async () => {
    const channelId = await createPrivateGroup();
    mockedLink.sendPersistedLinkJson.mockClear();

    await GroupService.removeMember(channelId, PEER_B);
    const removePeers = mockedLink.sendPersistedLinkJson.mock.calls.map(
      (call) => call[0]!.peerPubky,
    );
    expect(removePeers).toContain(PEER_B);
    mockedLink.sendPersistedLinkJson.mockClear();

    const sent = await GroupService.sendGroupMessage(channelId, "hello all");

    const peers = mockedLink.sendPersistedLinkJson.mock.calls.map(
      (call) => call[0]!.peerPubky,
    );
    expect(peers).toContain(PEER_A);
    expect(peers).not.toContain(PEER_B);
    expect(peers).not.toContain(OWNER);
    expect(sent.deliveryState).toBe("sent");
    const stored = await StorageService.listGroupMessages(OWNER, channelId);
    const chat = stored.find((m) => m.kind === GROUP_MESSAGE_KIND);
    expect(chat?.body).toBe("hello all");
    expect(chat?.deliveryState).toBe("sent");
  });

  it("does not queue fan-out for an active member whose Encrypted Link is not established", async () => {
    const channelId = await createPrivateGroup();
    await StorageService.updateLinkSnapshot(OWNER, PEER_B, "snap", "handshaking");
    mockedLink.sendPersistedLinkJson.mockClear();

    const sent = await GroupService.sendGroupMessage(channelId, "only linked");
    const peers = mockedLink.sendPersistedLinkJson.mock.calls.map(
      (call) => call[0]!.peerPubky,
    );
    expect(peers).toEqual([PEER_A]);
    expect(sent.deliveryState).toBe("sent");
    const queued = await StorageService.listDeliveryQueue();
    expect(queued.some((item) => item.recipientPubky === PEER_B)).toBe(false);
  });

  it("applies an inbound create so the receiver stores the founder-bound channel", async () => {
    const channelId = `${PEER_A}:00000000-0000-4000-8000-00000000aaaa`;
    const built = buildGroupMembershipEnvelope({
      channelId,
      eventId: EVENT,
      sentAt: NOW,
      op: "create",
      name: "Inbound",
      members: [OWNER, PEER_A],
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: built.envelope,
      rawJson: built.json,
      receivedAt: NOW,
    });
    const channel = await StorageService.getGroupChannel(OWNER, channelId);
    expect(channel?.createdBy).toBe(PEER_A);
    expect(channel?.name).toBe("Inbound");
    expect(await StorageService.getGroupMember(OWNER, channelId, OWNER)).toEqual(
      expect.objectContaining({ status: "active", memberPubky: OWNER }),
    );
  });

  it("applies a membership op from an admin and rejects one from a non-admin", async () => {
    const channelId = await createPrivateGroup();

    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupMembershipEnvelope({
        channelId,
        eventId: EVENT,
        sentAt: NOW + 1,
        op: "add",
        subjectPubky: PEER_C,
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW + 1,
    });
    expect(await StorageService.getGroupMember(OWNER, channelId, PEER_C)).toBeNull();

    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: OWNER,
      envelope: buildGroupMembershipEnvelope({
        channelId,
        eventId: EVENT2,
        sentAt: NOW + 2,
        op: "add",
        subjectPubky: PEER_C,
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW + 2,
    });
    expect(await StorageService.getGroupMember(OWNER, channelId, PEER_C)).toEqual(
      expect.objectContaining({ status: "active", memberPubky: PEER_C }),
    );
  });

  it("rejects edit and delete from a non-author", async () => {
    const channelId = await createPrivateGroup();
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupMessageEnvelope({
        channelId,
        eventId: EVENT,
        sentAt: NOW,
        body: "original",
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW,
    });

    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_B,
      envelope: buildGroupEditEnvelope({
        channelId,
        eventId: EVENT2,
        targetEventId: EVENT,
        targetAuthorPubky: PEER_A,
        body: "hijack",
        sentAt: NOW + 1,
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW + 1,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_B,
      envelope: buildGroupDeleteEnvelope({
        channelId,
        eventId: EVENT3,
        targetEventId: EVENT,
        targetAuthorPubky: PEER_A,
        sentAt: NOW + 2,
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW + 2,
    });

    const original = await StorageService.getGroupMessage(OWNER, channelId, PEER_A, EVENT);
    expect(original?.body).toBe("original");
    expect(original?.deleted).toBe(false);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_B, EVENT2)).toBe(false);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_B, EVENT3)).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_B, EVENT2)).toBe(true);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_B, EVENT3)).toBe(true);
  });

  it("defers reaction, edit, and delete that reference an unknown target instead of dropping them", async () => {
    const channelId = await createPrivateGroup();
    const EVENT4 = "00000000-0000-4000-8000-000000000004";
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupReactionEnvelope({
        channelId,
        eventId: EVENT,
        targetEventId: EVENT2,
        targetAuthorPubky: PEER_A,
        emoji: "👍",
        sentAt: NOW,
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupEditEnvelope({
        channelId,
        eventId: EVENT3,
        targetEventId: EVENT2,
        targetAuthorPubky: PEER_A,
        body: "later",
        sentAt: NOW + 1,
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW + 1,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupDeleteEnvelope({
        channelId,
        eventId: EVENT4,
        targetEventId: EVENT2,
        targetAuthorPubky: PEER_A,
        sentAt: NOW + 2,
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW + 2,
    });

    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, EVENT)).toBe(false);
    expect(await StorageService.getGroupMessage(OWNER, channelId, PEER_A, EVENT2)).toBeNull();
    const deferred = await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_A);
    expect(deferred.map((d) => d.kind).sort()).toEqual(
      ["chat.group.delete.v0", "chat.group.edit.v0", "chat.group.reaction.v0"].sort(),
    );

    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: buildGroupMessageEnvelope({
        channelId,
        eventId: EVENT2,
        sentAt: NOW + 3,
        body: "original",
      }).envelope,
      rawJson: "{}",
      receivedAt: NOW + 3,
    });
    const arrived = await StorageService.getGroupMessage(OWNER, channelId, PEER_A, EVENT2);
    expect(arrived?.body).toBe("later");
    expect(arrived?.editedAt).toBe(NOW + 1);
    expect(arrived?.deleted).toBe(true);
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_A, EVENT)).toBe(true);
    expect(await StorageService.listGroupDeferredForSender(OWNER, channelId, PEER_A)).toEqual([]);
  });

  it("dedups group messages by (owner, channel_id, sender_pubky, event_id)", async () => {
    const channelId = await createPrivateGroup();
    const envelope = buildGroupMessageEnvelope({
      channelId,
      eventId: EVENT,
      sentAt: NOW,
      body: "once",
    }).envelope;
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope,
      rawJson: '{"n":1}',
      receivedAt: NOW,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope,
      rawJson: '{"n":2}',
      receivedAt: NOW + 5,
    });
    const rows = (await StorageService.listGroupMessages(OWNER, channelId)).filter(
      (m) => m.kind === GROUP_MESSAGE_KIND && m.eventId === EVENT,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawJson).toBe('{"n":1}');
  });

  it("enqueues retry for a failed member without dropping the message or other sends", async () => {
    const channelId = await createPrivateGroup();
    mockedLink.sendPersistedLinkJson.mockImplementation(async (input) => {
      if (input.peerPubky === PEER_B) throw new Error("homeserver down");
      await StorageService.removeFromQueue(input.queueId);
      return "sent";
    });

    const message = await GroupService.sendGroupMessage(channelId, "partial");
    expect(message.body).toBe("partial");
    expect(message.deliveryState).toBe("sending");
    expect(await StorageService.getGroupMessage(OWNER, channelId, OWNER, message.eventId)).toEqual(
      expect.objectContaining({ body: "partial" }),
    );
    const queued = await StorageService.listDeliveryQueue();
    expect(queued.some((item) => item.recipientPubky === PEER_B)).toBe(true);
    expect(queued.some((item) => item.recipientPubky === PEER_A)).toBe(false);
    expect(mockedLink.sendPersistedLinkJson).toHaveBeenCalledWith(
      expect.objectContaining({ peerPubky: PEER_A }),
    );
  });

  it("adds a linked member and fans out chat.group.membership.v0 add", async () => {
    const channelId = await createPrivateGroup();
    await seedEstablishedLink(PEER_C);
    mockedLink.sendPersistedLinkJson.mockClear();
    const member = await GroupService.addMember(channelId, PEER_C);
    expect(member.status).toBe("active");
    expect(mockedLink.sendPersistedLinkJson).toHaveBeenCalledWith(
      expect.objectContaining({
        peerPubky: PEER_C,
        kind: "chat.group.membership.v0",
        channelId,
      }),
    );
    const addCall = mockedLink.sendPersistedLinkJson.mock.calls.find(
      (call) => call[0]!.peerPubky === PEER_C && call[0]!.kind === "chat.group.membership.v0",
    );
    expect(addCall?.[0]!.rawJson).toContain('"op":"add"');
  });

  it("rejects inbound group message from a removed or never-member sender", async () => {
    const channelId = await createPrivateGroup();
    await GroupService.removeMember(channelId, PEER_B);

    const fromRemoved = buildGroupMessageEnvelope({
      channelId,
      eventId: EVENT,
      sentAt: NOW + 10,
      body: "after-remove",
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_B,
      envelope: fromRemoved.envelope,
      rawJson: fromRemoved.json,
      receivedAt: NOW + 10,
    });
    expect(await StorageService.getGroupMessage(OWNER, channelId, PEER_B, EVENT)).toBeNull();
    expect(await StorageService.hasGroupMessage(OWNER, channelId, PEER_B, EVENT)).toBe(false);
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, PEER_B, EVENT)).toBe(true);

    const fromStranger = buildGroupMessageEnvelope({
      channelId,
      eventId: EVENT2,
      sentAt: NOW + 11,
      body: "never-a-member",
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: STRANGER,
      envelope: fromStranger.envelope,
      rawJson: fromStranger.json,
      receivedAt: NOW + 11,
    });
    expect(await StorageService.getGroupMessage(OWNER, channelId, STRANGER, EVENT2)).toBeNull();
    expect(await StorageService.hasGroupEventSeen(OWNER, channelId, STRANGER, EVENT2)).toBe(true);

    const history = (await StorageService.listGroupMessages(OWNER, channelId)).filter(
      (m) => m.kind === GROUP_MESSAGE_KIND,
    );
    expect(history.some((m) => m.body === "after-remove" || m.body === "never-a-member")).toBe(
      false,
    );
  });

  it("purges group search FTS when the owner leaves or is removed", async () => {
    const channelId = await createPrivateGroup();
    await GroupService.sendGroupMessage(channelId, "secret group token");
    expect((await LocalChatState.searchMessages(OWNER, "secret")).length).toBe(1);
    await GroupService.removeMember(channelId, PEER_B);
    expect((await LocalChatState.searchMessages(OWNER, "secret")).length).toBe(1);
    await GroupService.leaveChannel(channelId);
    expect((await LocalChatState.searchMessages(OWNER, "secret")).length).toBe(0);
  });

  it("purges group search FTS when inbound remove targets the owner", async () => {
    const channelId = await createPrivateGroup();
    await GroupService.sendGroupMessage(channelId, "kicked owner plaintext");
    expect((await LocalChatState.searchMessages(OWNER, "kicked")).length).toBe(1);
    const admin = await StorageService.getGroupMember(OWNER, channelId, PEER_A);
    expect(admin).toBeTruthy();
    await StorageService.upsertGroupMember({
      ...admin!,
      role: "admin",
    });
    const built = buildGroupMembershipEnvelope({
      channelId,
      eventId: EVENT3,
      sentAt: NOW + 40,
      op: "remove",
      subjectPubky: OWNER,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: built.envelope,
      rawJson: built.json,
      receivedAt: NOW + 40,
    });
    expect((await LocalChatState.searchMessages(OWNER, "kicked")).length).toBe(0);
  });

  it("rejects a forged create whose channel_id founder is not the authenticated sender", async () => {
    const forgedChannelId = `${OWNER}:00000000-0000-4000-8000-00000000ffff`;
    const built = buildGroupMembershipEnvelope({
      channelId: forgedChannelId,
      eventId: EVENT,
      sentAt: NOW,
      op: "create",
      name: "forged",
      members: [OWNER, PEER_C],
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_C,
      envelope: built.envelope,
      rawJson: built.json,
      receivedAt: NOW,
    });
    expect(await StorageService.getGroupChannel(OWNER, forgedChannelId)).toBeNull();
    expect(await StorageService.hasGroupMessage(OWNER, forgedChannelId, PEER_C, EVENT)).toBe(
      false,
    );
    expect(await StorageService.hasGroupEventSeen(OWNER, forgedChannelId, PEER_C, EVENT)).toBe(
      true,
    );

    const knownId = await createPrivateGroup();
    const knownBefore = await StorageService.getGroupChannel(OWNER, knownId);
    const reuse = buildGroupMembershipEnvelope({
      channelId: knownId,
      eventId: EVENT2,
      sentAt: NOW + 1,
      op: "create",
      name: "hijack-name",
      members: [OWNER, PEER_C],
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_C,
      envelope: reuse.envelope,
      rawJson: reuse.json,
      receivedAt: NOW + 1,
    });
    const knownAfter = await StorageService.getGroupChannel(OWNER, knownId);
    expect(knownAfter?.createdBy).toBe(OWNER);
    expect(knownAfter?.name).toBe(knownBefore?.name);
    expect(await StorageService.hasGroupEventSeen(OWNER, knownId, PEER_C, EVENT2)).toBe(true);
    expect(await StorageService.getGroupMember(OWNER, knownId, PEER_C)).toBeNull();
  });

  it("stores the same event_id from two senders as two separate rows", async () => {
    const channelId = await createPrivateGroup();
    const fromA = buildGroupMessageEnvelope({
      channelId,
      eventId: EVENT,
      sentAt: NOW,
      body: "from-a",
    });
    const fromB = buildGroupMessageEnvelope({
      channelId,
      eventId: EVENT,
      sentAt: NOW + 1,
      body: "from-b",
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      envelope: fromA.envelope,
      rawJson: fromA.json,
      receivedAt: NOW,
    });
    await applyGroupInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_B,
      envelope: fromB.envelope,
      rawJson: fromB.json,
      receivedAt: NOW + 1,
    });

    const rowA = await StorageService.getGroupMessage(OWNER, channelId, PEER_A, EVENT);
    const rowB = await StorageService.getGroupMessage(OWNER, channelId, PEER_B, EVENT);
    expect(rowA?.body).toBe("from-a");
    expect(rowB?.body).toBe("from-b");
    expect(rowA?.senderPubky).toBe(PEER_A);
    expect(rowB?.senderPubky).toBe(PEER_B);
    const rows = (await StorageService.listGroupMessages(OWNER, channelId)).filter(
      (m) => m.kind === GROUP_MESSAGE_KIND && m.eventId === EVENT,
    );
    expect(rows).toHaveLength(2);
  });

  it("enforces the 50-member cap on create and add", async () => {
    const extras = Array.from({ length: PRIVATE_GROUP_MEMBER_CAP }, (_, i) => fakePubky(i + 20));
    await expect(GroupService.createChannel("Too big", extras)).rejects.toThrow(/50/);

    const channelId = await createPrivateGroup();
    const active = await StorageService.countActiveGroupMembers(OWNER, channelId);
    for (let i = 0; i < PRIVATE_GROUP_MEMBER_CAP - active; i += 1) {
      await StorageService.upsertGroupMember({
        ownerPubky: OWNER,
        channelId,
        memberPubky: fakePubky(i + 200),
        role: "member",
        addedAt: NOW,
        removedAt: null,
        status: "active",
      });
    }
    await expect(GroupService.addMember(channelId, STRANGER)).rejects.toThrow(/50/);
  });
});

async function seedEstablishedLink(peerPubky: string): Promise<void> {
  await StorageService.upsertLink({
    ownerPubky: OWNER,
    peerPubky,
    role: "initiator",
    status: "established",
    snapshot: "HC1.test",
    remoteNoisePublicKey: "noise",
    localReceiverPath: LINK_RECEIVER_PATH,
    remoteReceiverPath: LINK_RECEIVER_PATH,
    consecutiveFailures: 0,
  });
}

function fakePubky(seed: number): string {
  return `${seed.toString(16).padStart(4, "0")}${"f".repeat(48)}`.slice(0, 52);
}
