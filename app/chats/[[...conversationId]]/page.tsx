import { ChatsPage } from "@/components/chats-page";

export function generateStaticParams() {
  return [{ conversationId: [] }];
}

export default function ChatsRoute() {
  return <ChatsPage />;
}
