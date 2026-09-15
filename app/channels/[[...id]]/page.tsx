import { ChannelsPage } from "@/components/channels-page";

export function generateStaticParams() {
  return [{ id: [] }];
}

export default function ChannelsRoute() {
  return <ChannelsPage />;
}
