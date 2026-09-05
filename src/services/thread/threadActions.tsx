"use client";

import { AttachmentBubble } from "@/components/attachment-bubble";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { ThreadView } from "@/components/thread-view";
import { useThread } from "@/hooks/useThread";
import { LinkService } from "@/services/link/LinkService";
import { useContactStore } from "@/stores/contactStore";
import type { AttachmentRecord } from "@/types/attachment";

export function ThreadViewHost({ conversationId }: { conversationId: string | null }) {
  const thread = useThread(conversationId);
  const contact = useContactStore((s) =>
    thread.participantPubky ? s.contacts[thread.participantPubky] : undefined,
  );

  return (
    <ThreadView
      conversationId={conversationId}
      participantPubky={thread.participantPubky}
      displayName={
        contact && (contact.addedManually || contact.lastInteractionAt)
          ? contact.displayName
          : null
      }
      localPubky={thread.localPubky}
      messages={thread.messages}
      attachments={thread.attachments}
      loading={thread.loading}
      error={thread.error}
      draft={thread.draft}
      sending={thread.sending}
      status={thread.status}
      enableCta={<EnableMessagingCta testId="threadEnableMessaging" />}
      renderAttachment={(record: AttachmentRecord, onResolved) => (
        <AttachmentBubble record={record} onResolved={onResolved} />
      )}
      onChangeDraft={thread.setDraft}
      onSend={() => void thread.send()}
      onAttach={(file) => void thread.sendAttachment(file)}
      onRetry={thread.retryFailed}
      onResolved={() => void thread.reload()}
      receiverRole={thread.receiverRole}
      linkStatus={thread.linkStatus}
      linkSnapshot={thread.linkSnapshot}
      linkReady={thread.linkReady}
      onTakeoverReceive={async () => {
        await LinkService.takeOverReceiver();
        await thread.reload();
        if (thread.draft.trim()) await thread.send();
      }}
    />
  );
}
