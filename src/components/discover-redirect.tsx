"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePathSegment } from "@/hooks/usePathSegment";
import { encodeTagPath } from "@/lib/tag-channel";

export function DiscoverRedirect() {
  const router = useRouter();
  const tag = usePathSegment("discover");

  useEffect(() => {
    const dest = tag
      ? `/channels/${encodeTagPath(tag)}?mode=public`
      : "/channels?mode=public";
    router.replace(dest);
  }, [router, tag]);

  return (
    <p className="text-sm text-muted-foreground" data-testid="discoverRedirect">
      Opening Channels…
    </p>
  );
}
