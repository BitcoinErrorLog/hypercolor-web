"use client";

import { useCallback, useEffect, useState } from "react";
import { AttachmentBubble } from "@/components/attachment-bubble";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { ThreadView } from "@/components/thread-view";
import { useGifConfigured } from "@/hooks/useGifConfigured";
import { fetchGifAsFile, usePendingAttach } from "@/hooks/usePendingAttach";
import { useThread } from "@/hooks/useThread";
import { dmThreadKey } from "@/lib/contact-label";
import { LinkService } from "@/services/link/LinkService";
import { LocalChatState } from "@/services/localChatState";
import { useContactStore } from "@/stores/contactStore";
import type { AttachmentRecord } from "@/types/attachment";

export function ThreadViewHost({ conversationId }: { conversationId: string | null }) {
  const thread = useThread(conversationId);
  const contact = useContactStore((s) =>
    thread.participantPubky ? s.contacts[thread.participantPubky] : undefined,
  );
  const gifConfigured = useGifConfigured();
  const pending = usePendingAttach(thread.sendAttachment);
  const [nickname, setNickname] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    if (!thread.localPubky || !thread.participantPubky || !conversationId) return;
    const key = dmThreadKey(conversationId);
    void LocalChatState.getNickname(thread.localPubky, thread.participantPubky).then(setNickname);
    void LocalChatState.getThreadFlags(thread.localPubky, key).then((flags) => {
      setMuted(flags.muted);
      setArchived(flags.archived);
    });
  }, [thread.localPubky, thread.participantPubky, conversationId]);

  const toggleMute = useCallback(async () => {
    if (!thread.localPubky || !conversationId) return;
    const next = !muted;
    await LocalChatState.setThreadFlags(thread.localPubky, dmThreadKey(conversationId), { muted: next });
    setMuted(next);
  }, [thread.localPubky, conversationId, muted]);

  const toggleArchive = useCallback(async () => {
    if (!thread.localPubky || !conversationId) return;
    const next = !archived;
    await LocalChatState.setThreadFlags(thread.localPubky, dmThreadKey(conversationId), { archived: next });
    setArchived(next);
  }, [thread.localPubky, conversationId, archived]);

  return (
    <ThreadView
      conversationId={conversationId}
      participantPubky={thread.participantPubky}
      displayName={
        contact && (contact.addedManually || contact.lastInteractionAt)
          ? contact.displayName
          : null
      }
      nickname={nickname}
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
      onAttach={(file) => pending.offer(file)}
      onOfferAttach={(file) => pending.offer(file)}
      onRetry={thread.retryFailed}
      onResolved={() => void thread.reload()}
      receiverRole={thread.receiverRole}
      linkStatus={thread.linkStatus}
      linkSnapshot={thread.linkSnapshot}
      linkReady={thread.linkReady}
      muted={muted}
      archived={archived}
      onToggleMute={() => void toggleMute()}
      onToggleArchive={() => void toggleArchive()}
      pendingFile={pending.pendingFile}
      pendingPreviewUrl={pending.pendingPreviewUrl}
      pendingError={pending.pendingError}
      onConfirmPending={() => void pending.confirm()}
      onCancelPending={pending.cancel}
      gifConfigured={gifConfigured}
      onPickGif={(hit) => {
        void fetchGifAsFile(hit).then((file) => pending.offer(file));
      }}
      onTakeoverReceive={async () => {
        await LinkService.takeOverReceiver();
        await thread.reload();
        if (thread.draft.trim()) await thread.send();
      }}
      tagsByTarget={thread.tagsByTarget}
      onToggleTag={(message, label, mine) => void thread.toggleTag(message, label, mine)}
      onUnsend={(message) => thread.unsend(message)}
    />
  );
}
