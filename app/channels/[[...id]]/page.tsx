import { PathSegmentPage } from "@/components/path-segment-page";

export function generateStaticParams() {
  return [{ id: [] }];
}

export default function ChannelsPage() {
  return <PathSegmentPage title="Channels" segment="channels" />;
}
