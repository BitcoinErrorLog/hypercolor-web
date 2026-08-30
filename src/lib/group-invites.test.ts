import { describe, expect, it } from "vitest";
import {
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildPrivateChannelId,
} from "@/types/group";
import {
  collectGroupInvitations,
  excludeHeldFounderChannels,
  heldGroupFounderSet,
  isHeldFounderChannel,
  peekGroupInvitation,
} from "./group-invites";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const OTHER = "q1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const LOCAL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EVENT_A = "00000000-0000-4000-8000-000000000001";
const EVENT_B = "00000000-0000-4000-8000-000000000002";

describe("held-peer group invitations", () => {
  const channelId = buildPrivateChannelId(PEER, LOCAL_ID);
  const createJson = buildGroupMembershipEnvelope({
    channelId,
    eventId: EVENT_A,
    sentAt: 1_700_000_000_000,
    op: "create",
    name: "Attacker Crew",
    members: [OWNER],
  }).json;
  const messageJson = buildGroupMessageEnvelope({
    channelId,
    eventId: EVENT_B,
    sentAt: 1_700_000_000_100,
    body: "attacker-chosen body",
  }).json;

  it("does not list or preview a held-peer founded group", () => {
    const held = heldGroupFounderSet([
      { peerPubky: PEER, status: "pending" },
      { peerPubky: OTHER, status: "accepted" },
    ]);
    expect(isHeldFounderChannel(channelId, held)).toBe(true);
    const visible = excludeHeldFounderChannels(
      [
        { channelId, name: "Attacker Crew" },
        { channelId: buildPrivateChannelId(OWNER, LOCAL_ID), name: "Mine" },
      ],
      held,
    );
    expect(visible.map((row) => row.name)).toEqual(["Mine"]);
  });

  it("surfaces only the group name from unprocessed held envelopes", () => {
    const invites = collectGroupInvitations(
      [{ rawJson: messageJson }, { rawJson: createJson }],
      PEER,
    );
    expect(invites).toEqual([
      { channelId, name: "Attacker Crew", founderPubky: PEER },
    ]);
    const peeked = peekGroupInvitation(messageJson, PEER);
    expect(peeked?.name).toBeNull();
    expect(JSON.stringify(invites)).not.toContain("attacker-chosen body");
  });

  it("accept removes the founder from the hold set so the channel can list", () => {
    const afterAccept = heldGroupFounderSet([{ peerPubky: PEER, status: "accepted" }]);
    expect(isHeldFounderChannel(channelId, afterAccept)).toBe(false);
    expect(
      excludeHeldFounderChannels([{ channelId, name: "Attacker Crew" }], afterAccept),
    ).toHaveLength(1);
  });

  it("decline keeps the founder held so the channel stays suppressed", () => {
    const afterDecline = heldGroupFounderSet([{ peerPubky: PEER, status: "declined" }]);
    expect(isHeldFounderChannel(channelId, afterDecline)).toBe(true);
    expect(
      excludeHeldFounderChannels([{ channelId, name: "Attacker Crew" }], afterDecline),
    ).toHaveLength(0);
    expect(collectGroupInvitations([], PEER)).toEqual([]);
  });

  it("ignores group envelopes whose founder is not the sender", () => {
    expect(peekGroupInvitation(createJson, OTHER)).toBeNull();
  });
});
