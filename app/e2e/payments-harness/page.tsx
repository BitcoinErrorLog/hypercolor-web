import { PaymentsHarnessPage } from "@/components/payments-harness-page";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default function PaymentsHarnessRoute() {
  requireE2eHarness();
  return <PaymentsHarnessPage />;
}
