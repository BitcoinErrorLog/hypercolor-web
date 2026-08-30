import Link from "next/link";
import { PlaceholderRoute } from "@/components/placeholder-route";

export default function EnablePage() {
  return (
    <PlaceholderRoute title="Enable">
      <p className="text-sm text-muted-foreground leading-6">
        Ring approval will return to{" "}
        <Link href="/ring-callback" className="underline underline-offset-4">
          /ring-callback
        </Link>
        . The page can already read <code>window.location.search</code>.
      </p>
    </PlaceholderRoute>
  );
}
