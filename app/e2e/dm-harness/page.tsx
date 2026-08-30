import { DmHarnessPage } from "@/components/dm-harness-page";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default function DmHarnessRoute() {
  requireE2eHarness();
  return <DmHarnessPage />;
}
