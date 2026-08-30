"use client";

import Link from "next/link";
import { Composer } from "@/components/composer";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { DmMessageBubble } from "@/components/message-bubble";
import { shortPubky } from "@/lib/format";
import { isMessagingEnabled } from "@/lib/session-ui";
import { useThread } from "@/hooks/useThread";
import { CHAT_ATTACHMENT_KIND } from "@/types/attachment";

export function ThreadView({ conversationId }: { conversationId: string | null }) {
  const thread = useThread(conversationId);

  if (!conversationId) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground">
        Select a conversation.
      </div>
    );
  }

  if (!thread.participantPubky) {
    return (
      <article className="space-y-3">
        <h2 className="text-lg font-semibold">Invalid conversation</h2>
        <p className="text-sm text-muted-foreground">
          This path is not a DM conversation id.
        </p>
      </article>
    );
  }

  return (
    <article className="flex h-full min-h-[28rem] flex-col" data-testid="threadScreen">
      <header className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Direct message</p>
          <h2 className="break-all font-mono text-sm" data-testid="threadPeer">
            {thread.participantPubky}
          </h2>
        </div>
        <Link
          href={`/contacts/${encodeURIComponent(thread.participantPubky)}`}
          className="text-sm text-brand underline-offset-4 hover:underline"
        >
          {shortPubky(thread.participantPubky)}
        </Link>
      </header>

      {!isMessagingEnabled(thread.status) ? (
        <EnableMessagingCta testId="threadEnableMessaging" />
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {thread.loading ? (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        ) : thread.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet. Send the first one.</p>
        ) : (
          thread.messages.map((message) => (
            <DmMessageBubble
              key={`${message.senderPubky}:${message.kind}:${message.eventId}`}
              message={message}
              attachment={
                message.kind === CHAT_ATTACHMENT_KIND
                  ? thread.attachments.find((row) => row.eventId === message.eventId)
                  : undefined
              }
              mine={message.senderPubky === thread.localPubky}
              onRetry={thread.retryFailed}
              onResolved={() => void thread.reload()}
            />
          ))
        )}
      </div>

      {thread.error ? <p className="mb-2 text-sm text-red-400">{thread.error}</p> : null}

      <Composer
        draft={thread.draft}
        sending={thread.sending}
        disabled={!isMessagingEnabled(thread.status)}
        placeholder="Message"
        onChangeDraft={thread.setDraft}
        onSend={() => void thread.send()}
        onAttach={(file) => void thread.sendAttachment(file)}
        testIdPrefix="thread"
      />
    </article>
  );
}
