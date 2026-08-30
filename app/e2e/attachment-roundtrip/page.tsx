import { AttachmentRoundtripPage } from "@/components/attachment-roundtrip-page";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default function AttachmentRoundtripRoute() {
  requireE2eHarness();
  return <AttachmentRoundtripPage />;
}
