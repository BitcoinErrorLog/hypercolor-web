import { DiscoverPage } from "@/components/discover-page";

export function generateStaticParams() {
  return [{ tag: [] }];
}

export default function DiscoverRoute() {
  return <DiscoverPage />;
}
