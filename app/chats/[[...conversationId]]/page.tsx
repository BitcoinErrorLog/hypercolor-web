import { PathSegmentPage } from "@/components/path-segment-page";

export function generateStaticParams() {
  return [{ conversationId: [] }];
}

export default function ChatsPage() {
  return <PathSegmentPage title="Chats" segment="chats" />;
}
