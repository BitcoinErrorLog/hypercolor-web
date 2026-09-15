import { Suspense } from "react";
import { ChannelsPage } from "@/components/channels-page";

export function generateStaticParams() {
  return [{ id: [] }];
}

export default function ChannelsRoute() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading channels…</p>}>
      <ChannelsPage />
    </Suspense>
  );
}
