"use client";

import { useState } from "react";
import { Composer } from "@/components/composer";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { AttachmentBubble } from "@/components/attachment-bubble";
import { GroupMessageBubble } from "@/components/message-bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChannel } from "@/hooks/useChannel";
import { sanitizeDisplayName } from "@/lib/display-name";
import { shortPubky } from "@/lib/format";
import { CHAT_ATTACHMENT_KIND } from "@/types/attachment";

export function ChannelView({ channelId }: { channelId: string | null }) {
  const channel = useChannel(channelId);
  const [addDraft, setAddDraft] = useState("");
  const [showMembers, setShowMembers] = useState(false);

  if (!channelId) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground">
        Select a channel.
      </div>
    );
  }

  if (channel.loading) {
    return <p className="text-sm text-muted-foreground">Loading channel…</p>;
  }

  if (!channel.channel) {
    return (
      <article className="space-y-3">
        <h2 className="text-lg font-semibold">Channel not found</h2>
        <p className="text-sm text-muted-foreground">
          This group is not on this device. You must be invited over an Encrypted Link.
        </p>
      </article>
    );
  }

  const addable = channel.establishedPeers.filter(
    (pubky) =>
      pubky !== channel.localPubky &&
      !channel.members.some((member) => member.memberPubky === pubky && member.status === "active"),
  );

  return (
    <article className="flex h-full min-h-[28rem] flex-col" data-testid="channelScreen">
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Private group</p>
          <h2 className="text-lg font-semibold" data-testid="channelName">
            {sanitizeDisplayName(channel.channel.name)}
          </h2>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowMembers((value) => !value)}
          data-testid="channelMembersToggle"
        >
          Members ({channel.members.filter((member) => member.status === "active").length})
        </Button>
      </header>

      {!channel.messagingEnabled ? <EnableMessagingCta testId="channelEnableMessaging" /> : null}

      {showMembers ? (
        <section className="mb-4 space-y-3 rounded-md border border-border bg-card p-4 text-sm">
          <ul className="space-y-2">
            {channel.members.map((member) => {
              const display = channel.contacts.find(
                (contact) => contact.pubky === member.memberPubky,
              )?.displayName;
              return (
              <li key={member.memberPubky} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-mono break-all">
                    {display ? sanitizeDisplayName(display) : shortPubky(member.memberPubky)}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {member.role}
                    {member.status === "removed" ? " · removed" : ""}
                  </span>
                </span>
                {channel.isAdmin &&
                member.status === "active" &&
                member.memberPubky !== channel.localPubky ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void channel.removeMember(member.memberPubky)}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
              );
            })}
          </ul>
          {channel.isAdmin ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void channel.addMember(addDraft).then(() => setAddDraft(""));
              }}
            >
              <p className="text-muted-foreground">
                New members must already have an established Encrypted Link with you.
                Fan-out never starts a handshake.
              </p>
              <Input
                value={addDraft}
                onChange={(event) => setAddDraft(event.target.value)}
                placeholder="Paste a linked pubky"
                list="channel-addable"
              />
              <datalist id="channel-addable">
                {addable.map((pubky) => (
                  <option key={pubky} value={pubky} />
                ))}
              </datalist>
              <Button type="submit" size="sm" disabled={addable.length === 0 && addDraft.length === 0}>
                Add member
              </Button>
            </form>
          ) : null}
          {channel.selfActive ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void channel.leave()}>
              Leave group
            </Button>
          ) : null}
        </section>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {channel.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          channel.messages.map((message) => {
            const attachment =
              message.kind === CHAT_ATTACHMENT_KIND
                ? channel.attachments.find((row) => row.eventId === message.eventId)
                : undefined;
            return (
              <GroupMessageBubble
                key={`${message.senderPubky}:${message.kind}:${message.eventId}`}
                message={message}
                attachmentSlot={
                  attachment ? (
                    <AttachmentBubble record={attachment} onResolved={() => void channel.reload()} />
                  ) : undefined
                }
                mine={message.senderPubky === channel.localPubky}
                localPubky={channel.localPubky}
                onRetry={channel.retryFailed}
                onReact={(emoji) => void channel.react(message.eventId, message.senderPubky, emoji)}
                onEdit={() => {
                  channel.setEditingEventId(message.eventId);
                  channel.setDraft(message.body);
                }}
                onDelete={() => void channel.deleteMessage(message.eventId)}
              />
            );
          })
        )}
      </div>

      {channel.error ? <p className="mb-2 text-sm text-red-400">{channel.error}</p> : null}

      <Composer
        draft={channel.draft}
        sending={channel.sending}
        disabled={!channel.messagingEnabled || !channel.selfActive}
        placeholder={channel.editingEventId ? "Edit message" : "Message the group"}
        onChangeDraft={channel.setDraft}
        onSend={() => void channel.send()}
        onAttach={(file) => void channel.sendAttachment(file)}
        testIdPrefix="channel"
      />
    </article>
  );
}
