import { ChatsPageHost } from "@/services/chats/chatsPageHost";

/** Deep links only. The list lives at `app/chats/page.tsx` so `/chats` hydrates
 *  like `/enable`. Production rewrites `/chats/:id` to `/chats`. */
export function generateStaticParams() {
  return [];
}

export default function ChatConversationRoute() {
  return <ChatsPageHost />;
}
