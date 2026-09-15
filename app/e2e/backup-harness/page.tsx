import { BackupHarnessPage } from "@/components/backup-harness-page";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default function BackupHarnessRoute() {
  requireE2eHarness();
  return <BackupHarnessPage />;
}
