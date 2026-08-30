"use client";

import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { ChatsPage } from "@/components/chats-page";
import { usePathSegment } from "@/hooks/usePathSegment";
import { ThreadViewHost } from "@/services/thread/threadActions";

export function ChatsPageHost() {
  const conversationId = usePathSegment("chats");
  return (
    <ChatsPage
      conversationId={conversationId}
      enableCta={<EnableMessagingCta testId="chatsEnableMessaging" />}
      thread={<ThreadViewHost conversationId={conversationId} />}
    />
  );
}
