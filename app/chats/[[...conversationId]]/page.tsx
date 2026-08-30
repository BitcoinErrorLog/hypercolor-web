import { ChatsPageHost } from "@/services/chats/chatsPageHost";

export function generateStaticParams() {
  return [{ conversationId: [] }];
}

export default function ChatsRoute() {
  return <ChatsPageHost />;
}
