import { MigrationHarnessPage } from "@/components/migration-harness-page";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default function MigrationHarnessRoute() {
  requireE2eHarness();
  return <MigrationHarnessPage />;
}
