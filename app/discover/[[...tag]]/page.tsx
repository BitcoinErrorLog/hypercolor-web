import { DiscoverRedirect } from "@/components/discover-redirect";

export function generateStaticParams() {
  return [{ tag: [] }];
}

export default function DiscoverRoute() {
  return <DiscoverRedirect />;
}
