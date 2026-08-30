import { KeyStore } from "@/services/KeyStore";
import { GroupService } from "@/services/group/GroupService";
import { runDmEnsure, runDmSignup } from "./dmHarness";
import { LinkService } from "./LinkService";

export { runDmEnsure, runDmSignup };

export type GroupCreateResult = {
  channelId: string;
  name: string;
  memberCount: number;
};

export type GroupMessageView = {
  channelId: string;
  eventId: string;
  senderPubky: string;
  body: string;
  kind: string;
  deliveryState: string;
};

export type GroupStateView = {
  channelId: string;
  name: string;
  createdBy: string;
  members: { pubky: string; role: string; status: string }[];
  messages: GroupMessageView[];
};

export async function runGroupCreate(
  name: string,
  memberPubkys: string[],
): Promise<GroupCreateResult> {
  const channel = await GroupService.createChannel(
    name,
    memberPubkys.map((pubky) => pubky.trim()),
  );
  const members = await GroupService.listMembers(channel.channelId);
  return {
    channelId: channel.channelId,
    name: channel.name,
    memberCount: members.filter((member) => member.status === "active").length,
  };
}

export async function runGroupSend(
  channelId: string,
  body: string,
): Promise<GroupMessageView> {
  const sent = await GroupService.sendGroupMessage(channelId, body);
  return {
    channelId: sent.channelId,
    eventId: sent.eventId,
    senderPubky: sent.senderPubky,
    body: sent.body,
    kind: sent.kind,
    deliveryState: sent.deliveryState,
  };
}

export async function runGroupSync(peers: string[]): Promise<{
  channels: { channelId: string; name: string }[];
  messages: GroupMessageView[];
}> {
  await LinkService.syncInbox(peers.map((peer) => peer.trim()));
  return collectGroupState();
}

export async function runGroupGet(channelId: string): Promise<GroupStateView | null> {
  const channel = await GroupService.getChannel(channelId);
  if (!channel) return null;
  const members = await GroupService.listMembers(channelId);
  const messages = await GroupService.listMessages(channelId);
  return {
    channelId: channel.channelId,
    name: channel.name,
    createdBy: channel.createdBy,
    members: members.map((member) => ({
      pubky: member.memberPubky,
      role: member.role,
      status: member.status,
    })),
    messages: messages.map(toView),
  };
}

async function collectGroupState(): Promise<{
  channels: { channelId: string; name: string }[];
  messages: GroupMessageView[];
}> {
  const owner = await KeyStore.getPubky();
  if (!owner) {
    return { channels: [], messages: [] };
  }
  const channels = await GroupService.listChannels();
  const messages: GroupMessageView[] = [];
  for (const channel of channels) {
    const rows = await GroupService.listMessages(channel.channelId);
    messages.push(...rows.map(toView));
  }
  return {
    channels: channels.map((channel) => ({
      channelId: channel.channelId,
      name: channel.name,
    })),
    messages,
  };
}

function toView(row: {
  channelId: string;
  eventId: string;
  senderPubky: string;
  body: string;
  kind: string;
  deliveryState: string;
}): GroupMessageView {
  return {
    channelId: row.channelId,
    eventId: row.eventId,
    senderPubky: row.senderPubky,
    body: row.body,
    kind: row.kind,
    deliveryState: row.deliveryState,
  };
}
