import { PRIVATE_GROUP_MEMBER_CAP } from "../../flags/config";
import type { DeliveryQueueItem, PubkyKey } from "../../types";
import {
  GROUP_DELETE_KIND,
  GROUP_EDIT_KIND,
  GROUP_MEMBERSHIP_KIND,
  GROUP_MESSAGE_KIND,
  GROUP_REACTION_KIND,
  GroupServiceError,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  buildGroupDeleteEnvelope,
  buildGroupEditEnvelope,
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildGroupReactionEnvelope,
  buildPrivateChannelId,
  packMembershipCreate,
  type GroupChannel,
  type GroupMember,
  type GroupMessage,
} from "../../types/group";
import { CHAT_ATTACHMENT_KIND } from "../../types/attachment";
import { fingerprintStoredAttachmentSecret } from "../attachments/redaction";
import { KeyStore } from "../KeyStore";
import { StorageService } from "../StorageService";
import { LinkService } from "../link/LinkService";
import { notifyGroupEvent } from "./groupEvents";

export { subscribeGroupEvents } from "./groupEvents";
export { PRIVATE_GROUP_MEMBER_CAP };

/**
 * Private groups over pairwise Encrypted Link fan-out.
 * Wire-compatible with mobile `GroupService` at pin c7157aa.
 *
 * Public channels are out of scope on web (homeserver plaintext, no links).
 *
 * Fan-out only includes active members with an *established* Encrypted Link.
 * That keeps send off the WoT initiate path and lets delivery settle to
 * `sent` when some members (e.g. B↔C) never linked.
 */
export const GroupService = {
  async listChannels(): Promise<GroupChannel[]> {
    return StorageService.listGroupChannels(await requireOwner());
  },

  async getChannel(channelId: string): Promise<GroupChannel | null> {
    return StorageService.getGroupChannel(await requireOwner(), channelId);
  },

  async listMembers(channelId: string): Promise<GroupMember[]> {
    return StorageService.listGroupMembers(await requireOwner(), channelId);
  },

  async listMessages(channelId: string, limit = 100): Promise<GroupMessage[]> {
    return StorageService.listGroupMessages(await requireOwner(), channelId, limit);
  },

  async isLocalAdmin(channelId: string): Promise<boolean> {
    const owner = await requireOwner();
    const member = await StorageService.getGroupMember(owner, channelId, owner);
    return member?.status === "active" && member.role === "admin";
  },

  /**
   * Creates a private group. Creator is admin. Membership is announced by
   * pairwise fan-out of `chat.group.membership.v0` `{op:'create'}`.
   * Every named member except the creator must already have an established
   * Encrypted Link (WoT already passed at handshake).
   */
  async createChannel(name: string, memberPubkys: PubkyKey[]): Promise<GroupChannel> {
    const owner = await requireOwner();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new GroupServiceError("invalid-input", "Channel name must not be empty");
    }
    const roster = uniquePubkys([owner, ...memberPubkys]);
    if (roster.length > PRIVATE_GROUP_MEMBER_CAP) {
      throw new GroupServiceError(
        "member-cap",
        `Private groups are limited to ${PRIVATE_GROUP_MEMBER_CAP} members`,
      );
    }
    await requireEstablishedLinks(owner, roster.filter((pubky) => pubky !== owner));

    const channelId = buildPrivateChannelId(owner, crypto.randomUUID());
    const ts = Date.now();
    const channel: GroupChannel = {
      ownerPubky: owner,
      channelId,
      name: trimmed,
      createdAt: ts,
      updatedAt: ts,
      createdBy: owner,
      isPublic: false,
      lastMessageAt: ts,
      membershipEpoch: 0,
    };
    await StorageService.upsertGroupChannel(channel);
    for (const memberPubky of roster) {
      await StorageService.upsertGroupMember({
        ownerPubky: owner,
        channelId,
        memberPubky,
        role: memberPubky === owner ? "admin" : "member",
        addedAt: ts,
        removedAt: null,
        status: "active",
      });
    }

    const eventId = crypto.randomUUID();
    const packed = packMembershipCreate({
      channelId,
      eventId,
      sentAt: ts,
      name: trimmed,
      members: roster,
    });
    await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_MEMBERSHIP_KIND,
      eventId,
      sentAt: ts,
      body: "create",
      rawJson: packed.json,
      replyToEventId: null,
      targetEventId: null,
    });

    for (const subject of packed.overflow) {
      if (subject === owner) continue;
      await fanOutMembershipOp(owner, channelId, "add", subject);
    }

    notifyGroupEvent(owner, channelId);
    return channel;
  },

  async sendGroupMessage(
    channelId: string,
    body: string,
    replyTo?: { eventId: string; authorPubky: string },
  ): Promise<GroupMessage> {
    const owner = await requireOwner();
    await requireActiveMember(owner, channelId, owner);
    const channel = await requirePrivateChannel(owner, channelId);
    const eventId = crypto.randomUUID();
    const sentAt = Date.now();
    const built =
      replyTo !== undefined
        ? buildGroupMessageEnvelope({
            channelId,
            eventId,
            sentAt,
            body,
            replyTo: replyTo.eventId,
            replyToAuthor: replyTo.authorPubky,
          })
        : buildGroupMessageEnvelope({ channelId, eventId, sentAt, body });
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_MESSAGE_KIND,
      eventId,
      sentAt,
      body: built.envelope.body,
      rawJson: built.json,
      replyToEventId: built.envelope.reply_to ?? null,
      replyToAuthorPubky: built.envelope.reply_to_author ?? null,
      targetEventId: null,
    });
    await StorageService.touchGroupChannel(owner, channel.channelId, sentAt);
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async reactToMessage(
    channelId: string,
    targetEventId: string,
    emoji: string,
    targetAuthorPubky: PubkyKey,
  ): Promise<GroupMessage> {
    const owner = await requireOwner();
    await requireActiveMember(owner, channelId, owner);
    await requirePrivateChannel(owner, channelId);
    const eventId = crypto.randomUUID();
    const sentAt = Date.now();
    const target = await StorageService.getGroupMessage(
      owner,
      channelId,
      targetAuthorPubky,
      targetEventId,
    );
    if (!target) {
      throw new GroupServiceError(
        "not-found",
        "Cannot react to a message that is not on this device",
      );
    }
    const built = buildGroupReactionEnvelope({
      channelId,
      eventId,
      targetEventId,
      targetAuthorPubky,
      emoji,
      sentAt,
    });
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_REACTION_KIND,
      eventId,
      sentAt,
      body: built.envelope.emoji,
      rawJson: built.json,
      replyToEventId: null,
      targetEventId,
      targetAuthorPubky,
    });
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async editMessage(channelId: string, targetEventId: string, body: string): Promise<GroupMessage> {
    const owner = await requireOwner();
    await requireActiveMember(owner, channelId, owner);
    await requirePrivateChannel(owner, channelId);
    const target = await StorageService.getGroupMessage(owner, channelId, owner, targetEventId);
    if (!target) {
      throw new GroupServiceError("not-found", "Cannot edit a message that is not on this device");
    }
    if (target.senderPubky !== owner) {
      throw new GroupServiceError("not-author", "Only the original author can edit a message");
    }
    const eventId = crypto.randomUUID();
    const sentAt = Date.now();
    const built = buildGroupEditEnvelope({
      channelId,
      eventId,
      targetEventId,
      targetAuthorPubky: owner,
      body,
      sentAt,
    });
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_EDIT_KIND,
      eventId,
      sentAt,
      body: built.envelope.body,
      rawJson: built.json,
      replyToEventId: null,
      targetEventId,
      targetAuthorPubky: owner,
    });
    await StorageService.applyGroupMessageEdit(
      owner,
      channelId,
      owner,
      targetEventId,
      built.envelope.body,
      sentAt,
    );
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async deleteMessage(channelId: string, targetEventId: string): Promise<GroupMessage> {
    const owner = await requireOwner();
    await requireActiveMember(owner, channelId, owner);
    await requirePrivateChannel(owner, channelId);
    const target = await StorageService.getGroupMessage(owner, channelId, owner, targetEventId);
    if (!target) {
      throw new GroupServiceError(
        "not-found",
        "Cannot delete a message that is not on this device",
      );
    }
    if (target.senderPubky !== owner) {
      throw new GroupServiceError("not-author", "Only the original author can delete a message");
    }
    const eventId = crypto.randomUUID();
    const sentAt = Date.now();
    const built = buildGroupDeleteEnvelope({
      channelId,
      eventId,
      targetEventId,
      targetAuthorPubky: owner,
      sentAt,
    });
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_DELETE_KIND,
      eventId,
      sentAt,
      body: "",
      rawJson: built.json,
      replyToEventId: null,
      targetEventId,
      targetAuthorPubky: owner,
    });
    await StorageService.tombstoneGroupMessage(owner, channelId, owner, targetEventId);
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async addMember(channelId: string, memberPubky: PubkyKey): Promise<GroupMember> {
    const owner = await requireOwner();
    await requireAdmin(owner, channelId);
    const channel = await requirePrivateChannel(owner, channelId);
    const existing = await StorageService.getGroupMember(owner, channelId, memberPubky);
    if (existing?.status === "active") return existing;
    const active = await StorageService.countActiveGroupMembers(owner, channelId);
    if (active >= PRIVATE_GROUP_MEMBER_CAP) {
      throw new GroupServiceError(
        "member-cap",
        `Private groups are limited to ${PRIVATE_GROUP_MEMBER_CAP} members`,
      );
    }
    await requireEstablishedLinks(owner, [memberPubky]);
    const ts = Date.now();
    const member: GroupMember = {
      ownerPubky: owner,
      channelId: channel.channelId,
      memberPubky,
      role: "member",
      addedAt: ts,
      removedAt: null,
      status: "active",
    };
    await StorageService.upsertGroupMember(member);
    await fanOutMembershipOp(owner, channelId, "add", memberPubky);
    notifyGroupEvent(owner, channelId);
    return member;
  },

  /**
   * Admin-only. Marks the member `removed`, bumps `membership_epoch`, and
   * stops including them in future fan-out. Pairwise fan-out means cutoff
   * is immediate — there is no shared secret to rotate.
   */
  async removeMember(channelId: string, memberPubky: PubkyKey): Promise<void> {
    const owner = await requireOwner();
    await requireAdmin(owner, channelId);
    await requirePrivateChannel(owner, channelId);
    const existing = await StorageService.getGroupMember(owner, channelId, memberPubky);
    if (!existing || existing.status === "removed") return;
    const ts = Date.now();
    await StorageService.upsertGroupMember({
      ...existing,
      status: "removed",
      removedAt: ts,
    });
    await StorageService.bumpGroupMembershipEpoch(owner, channelId);
    if (memberPubky === owner) {
      await StorageService.purgeGroupSearch(owner, channelId);
    }
    await fanOutMembershipOp(owner, channelId, "remove", memberPubky, [memberPubky]);
    notifyGroupEvent(owner, channelId);
  },

  async leaveChannel(channelId: string): Promise<void> {
    const owner = await requireOwner();
    const channel = await StorageService.getGroupChannel(owner, channelId);
    if (!channel) throw new GroupServiceError("not-found", "Channel not found");
    if (channel.isPublic) {
      throw new GroupServiceError("private-only", "Public channels are out of scope");
    }
    await requireActiveMember(owner, channelId, owner);
    const self = await StorageService.getGroupMember(owner, channelId, owner);
    if (self) {
      await StorageService.upsertGroupMember({
        ...self,
        status: "removed",
        removedAt: Date.now(),
      });
    }
    await StorageService.bumpGroupMembershipEpoch(owner, channelId);
    await StorageService.purgeGroupSearch(owner, channelId);
    await fanOutMembershipOp(owner, channelId, "leave", owner);
    notifyGroupEvent(owner, channelId);
  },

  /**
   * Fans out a caller-built PAM (e.g. `chat.attachment.v0`) to active
   * private-group members that already have an established Encrypted Link.
   */
  async sendPreparedFanout(input: {
    channelId: string;
    kind: string;
    eventId: string;
    sentAt: number;
    body: string;
    rawJson: string;
  }): Promise<GroupMessage> {
    const owner = await requireOwner();
    await requireActiveMember(owner, input.channelId, owner);
    const channel = await requirePrivateChannel(owner, input.channelId);
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId: input.channelId,
      senderPubky: owner,
      kind: input.kind,
      eventId: input.eventId,
      sentAt: input.sentAt,
      body: input.body,
      rawJson: input.rawJson,
      replyToEventId: null,
      targetEventId: null,
    });
    await StorageService.touchGroupChannel(owner, channel.channelId, input.sentAt);
    notifyGroupEvent(owner, input.channelId);
    return message;
  },
};

async function fanOutMembershipOp(
  ownerPubky: PubkyKey,
  channelId: string,
  op: "add" | "remove" | "leave",
  subjectPubky: PubkyKey,
  extraRecipients: PubkyKey[] = [],
): Promise<void> {
  const eventId = crypto.randomUUID();
  const sentAt = Date.now();
  const built = buildGroupMembershipEnvelope({
    channelId,
    eventId,
    sentAt,
    op,
    subjectPubky,
  });
  await fanOutEnvelope({
    ownerPubky,
    channelId,
    senderPubky: ownerPubky,
    kind: GROUP_MEMBERSHIP_KIND,
    eventId,
    sentAt,
    body: op,
    rawJson: built.json,
    replyToEventId: null,
    targetEventId: null,
    targetAuthorPubky: null,
    extraRecipients,
  });
}

async function fanOutEnvelope(input: {
  ownerPubky: PubkyKey;
  channelId: string;
  senderPubky: PubkyKey;
  kind: string;
  eventId: string;
  sentAt: number;
  body: string;
  rawJson: string;
  replyToEventId: string | null;
  replyToAuthorPubky?: string | null;
  targetEventId: string | null;
  targetAuthorPubky?: string | null;
  extraRecipients?: PubkyKey[];
}): Promise<GroupMessage> {
  const recipients = await establishedFanoutRecipients(
    input.ownerPubky,
    input.channelId,
    input.extraRecipients ?? [],
  );
  const ts = Date.now();
  const secretFingerprint =
    input.kind === CHAT_ATTACHMENT_KIND
      ? await fingerprintStoredAttachmentSecret(input.ownerPubky, input.senderPubky, input.eventId)
      : undefined;
  const message: GroupMessage = {
    ownerPubky: input.ownerPubky,
    channelId: input.channelId,
    eventId: input.eventId,
    senderPubky: input.senderPubky,
    kind: input.kind,
    body: input.body,
    rawJson: input.rawJson,
    sentAt: input.sentAt,
    receivedAt: null,
    deliveryState: recipients.length === 0 ? "sent" : "sending",
    replyToEventId: input.replyToEventId,
    replyToAuthorPubky: input.replyToAuthorPubky ?? null,
    targetEventId: input.targetEventId,
    targetAuthorPubky: input.targetAuthorPubky ?? null,
    editedAt: null,
    deleted: false,
  };
  const queueItems: DeliveryQueueItem[] = recipients.map((peerPubky) => ({
    id: crypto.randomUUID(),
    messageId: input.eventId,
    recipientPubky: peerPubky,
    payload: JSON.stringify({
      type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
      ownerPubky: input.ownerPubky,
      peerPubky,
      senderPubky: input.senderPubky,
      kind: input.kind,
      eventId: input.eventId,
      channelId: input.channelId,
      rawJson: input.rawJson,
      ...(secretFingerprint ? { secretFingerprint } : {}),
    }),
    attempts: 0,
    nextRetryAt: ts,
    createdAt: ts,
  }));
  await StorageService.persistGroupSendIntent({ message, queueItems });

  let anySent = recipients.length === 0;
  for (let i = 0; i < recipients.length; i += 1) {
    const peerPubky = recipients[i]!;
    const queueItem = queueItems[i]!;
    try {
      const result = await LinkService.sendPersistedLinkJson({
        peerPubky,
        queueId: queueItem.id,
        kind: input.kind,
        eventId: input.eventId,
        rawJson: input.rawJson,
        channelId: input.channelId,
      });
      if (result === "sent") anySent = true;
    } catch {
      // Queue item stays; other members are still sent.
    }
  }

  const remaining = await StorageService.countDeliveryQueueForMessage(input.eventId);
  const nextState =
    remaining === 0 ? (anySent || recipients.length === 0 ? "sent" : "failed") : "sending";
  if (nextState !== "sending") {
    await StorageService.updateGroupMessageDeliveryState(
      input.ownerPubky,
      input.channelId,
      input.senderPubky,
      input.eventId,
      nextState,
    );
  }
  return { ...message, deliveryState: nextState };
}

async function establishedFanoutRecipients(
  ownerPubky: PubkyKey,
  channelId: string,
  extraRecipients: PubkyKey[],
): Promise<PubkyKey[]> {
  const members = await StorageService.listGroupMembers(ownerPubky, channelId, "active");
  const candidates = uniquePubkys([
    ...members.map((member) => member.memberPubky),
    ...extraRecipients,
  ]).filter((pubky) => pubky !== ownerPubky);
  const out: PubkyKey[] = [];
  for (const peerPubky of candidates) {
    if (await hasEstablishedLink(ownerPubky, peerPubky)) {
      out.push(peerPubky);
    }
  }
  return out;
}

async function hasEstablishedLink(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<boolean> {
  const link = await StorageService.getLink(ownerPubky, peerPubky);
  return link?.status === "established";
}

async function requireEstablishedLinks(ownerPubky: PubkyKey, peers: PubkyKey[]): Promise<void> {
  for (const peerPubky of peers) {
    if (!(await hasEstablishedLink(ownerPubky, peerPubky))) {
      throw new GroupServiceError(
        "invalid-input",
        "No established Encrypted Link with that member",
      );
    }
  }
}

async function requirePrivateChannel(
  ownerPubky: PubkyKey,
  channelId: string,
): Promise<GroupChannel> {
  const channel = await StorageService.getGroupChannel(ownerPubky, channelId);
  if (!channel) throw new GroupServiceError("not-found", "Channel not found");
  if (channel.isPublic) {
    throw new GroupServiceError("private-only", "Use the public-channel publish path");
  }
  return channel;
}

async function requireActiveMember(
  ownerPubky: PubkyKey,
  channelId: string,
  memberPubky: PubkyKey,
): Promise<GroupMember> {
  const member = await StorageService.getGroupMember(ownerPubky, channelId, memberPubky);
  if (!member || member.status !== "active") {
    throw new GroupServiceError("not-member", "Not an active member of this channel");
  }
  return member;
}

async function requireAdmin(ownerPubky: PubkyKey, channelId: string): Promise<GroupMember> {
  const member = await requireActiveMember(ownerPubky, channelId, ownerPubky);
  if (member.role !== "admin") {
    throw new GroupServiceError("not-admin", "Only a channel admin can change membership");
  }
  return member;
}

async function requireOwner(): Promise<PubkyKey> {
  const owner = await KeyStore.getPubky();
  if (!owner) throw new GroupServiceError("invalid-input", "No local pubky");
  return owner;
}

function uniquePubkys(values: PubkyKey[]): PubkyKey[] {
  const seen = new Set<string>();
  const out: PubkyKey[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
