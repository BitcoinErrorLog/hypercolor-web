import { OwnerRoundtripPage } from "@/components/owner-roundtrip-page";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default function OwnerRoundtripRoute() {
  requireE2eHarness();
  return <OwnerRoundtripPage />;
}
