import { pubkyAnchorParts } from "@/lib/pubky-anchors";

export function PubkyAnchors({
  pubky,
  className = "break-all font-mono text-xs text-muted-foreground",
}: {
  pubky: string;
  className?: string;
}) {
  const { head, mid, tail } = pubkyAnchorParts(pubky);
  return (
    <span className={className} data-testid="pubkyAnchors">
      <strong className="font-bold text-foreground">{head}</strong>
      {mid}
      <strong className="font-bold text-foreground">{tail}</strong>
    </span>
  );
}
